/**
 * Copyright JS Foundation and other contributors, http://js.foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 * http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 **/
/*
 * Modified by Actuna Sp. z o.o.:
 *   #45: tests of hiding the credentials of URLs in the event-log; the output is logged by
 *   lines (one event per line and stream instead of one per chunk); a very long line is not
 *   cut inside a URL or a secret, also when the cut falls inside a complete one (SEC-009)
 *   #63: a long line without a newline is cut at a white space (the first logged event ends with it)
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
var should = require("should");
var sinon = require("sinon");
var path = require("path");
var EventEmitter = require("events").EventEmitter;


var child_process = require('child_process');

var NR_TEST_UTILS = require("nr-test-utils");

var events = NR_TEST_UTILS.require("@node-red/util/lib/events");
var exec = NR_TEST_UTILS.require("@node-red/util/lib/exec");

describe("runtime/exec", function() {
    var logEvents;
    var mockProcess;
    const eventLogHandler = function(ev) {
        logEvents.push(ev);
    }

    beforeEach(function() {

        logEvents = [];
        events.on("event-log", eventLogHandler);

        mockProcess = new EventEmitter();
        mockProcess.stdout = new EventEmitter();
        mockProcess.stderr = new EventEmitter();
        sinon.stub(child_process,'spawn').callsFake(function(command,args,options) {
            mockProcess._args = {command,args,options};
            return mockProcess;
        });
    });

    afterEach(function() {
        events.removeListener("event-log", eventLogHandler);
        if (child_process.spawn.restore) {
            child_process.spawn.restore();
        }
    });

    it("runs command and resolves on success - no emit", function(done) {
        var command = "cmd";
        var args = [1,2,3];
        var opts = { a: true };
        exec.run(command,args,opts).then(function(result) {
            command.should.eql(mockProcess._args.command);
            args.should.eql(mockProcess._args.args);
            opts.should.eql(mockProcess._args.options);
            logEvents.length.should.eql(0);
            result.code.should.eql(0);
            result.stdout.should.eql("123");
            result.stderr.should.eql("abc");
            done();
        }).catch(done);

        mockProcess.stdout.emit('data',"1");
        mockProcess.stderr.emit('data',"a");
        mockProcess.stderr.emit('data',"b");
        mockProcess.stdout.emit('data',"2");
        mockProcess.stdout.emit('data',"3");
        mockProcess.stderr.emit('data',"c");
        mockProcess.emit('close',0);
    });

    it("runs command and resolves on success - emit", function(done) {
        var command = "cmd";
        var args = [1,2,3];
        var opts = { a: true };
        exec.run(command,args,opts,true).then(function(result) {
            // the command, the output of each stream (logged by lines, the tails on close), rc
            logEvents.length.should.eql(4);
            logEvents[0].payload.data.should.eql("cmd 1 2 3");
            logEvents.filter(e => e.payload.type === "out").map(e => e.payload.data).should.eql(["123"]);
            logEvents.filter(e => e.payload.type === "err").map(e => e.payload.data).should.eql(["abc"]);
            logEvents[3].payload.should.have.property("data","rc=0");
            done();
        }).catch(done);

        mockProcess.stdout.emit('data',"1");
        mockProcess.stderr.emit('data',"a");
        mockProcess.stderr.emit('data',"b");
        mockProcess.stdout.emit('data',"2");
        mockProcess.stdout.emit('data',"3");
        mockProcess.stderr.emit('data',"c");
        mockProcess.emit('close',0);
    })

    it("hides the credentials of URLs in the event-log, not in the result", function(done) {
        exec.run("git",["clone","--","https://user:s3cret@host/r.git","."],{},true).then(function(result) {
            JSON.stringify(logEvents).should.not.containEql("s3cret");
            JSON.stringify(logEvents).should.containEql("https://***@host/r.git");
            // the result is for the caller, the credentials are not touched there
            result.stdout.should.containEql("s3cret");
            done();
        }).catch(done);

        mockProcess.stdout.emit('data',"Cloning into https://user:s3cret@host/r.git");
        mockProcess.emit('close',0);
    })

    it("hides the credentials of URLs in the error output of the event-log", function(done) {
        exec.run("git",["fetch"],{},true).then(function() {
            done(new Error("should have failed"));
        }).catch(function(result) {
            JSON.stringify(logEvents).should.not.containEql("s3cret");
            JSON.stringify(logEvents).should.containEql("https://***@host/r.git");
            done();
        }).catch(done);

        mockProcess.stderr.emit('data',"fatal: unable to access 'https://user:s3cret@host/r.git/'");
        mockProcess.emit('close',1);
    })

    it("hides a URL split between two chunks of the output (#45)", function(done) {
        exec.run("git",["fetch"],{},true).then(function() {
            done(new Error("should have failed"));
        }).catch(function(result) {
            var text = JSON.stringify(logEvents);
            text.should.not.containEql("s3cret");
            text.should.not.containEql("t0ken");
            text.should.containEql("https://***@host/r.git");
            text.should.containEql("https://***@other/x.git");
            // the lines are complete, the stream of the result is untouched
            logEvents.filter(e => e.payload.type === "err").map(e => e.payload.data).should.eql([
                "fatal: unable to access 'https://***@host/r.git/'\n",
                "second https://***@other/x.git"
            ]);
            result.stderr.should.containEql("s3cret");
            done();
        }).catch(done);

        mockProcess.stderr.emit('data',"fatal: unable to access 'https://us");
        mockProcess.stdout.emit('data',"interleaved output of the other stream\n");
        mockProcess.stderr.emit('data',"er:s3c");
        mockProcess.stderr.emit('data',"ret@host/r.git/'\nsecond https://t0k");
        mockProcess.stderr.emit('data',"en@other/x.git");
        mockProcess.emit('close',1);
    })

    it("logs a line ending with a carriage return and flushes the tail on close", function(done) {
        exec.run("cmd",[],{},true).then(function() {
            logEvents.filter(e => e.payload.type === "out").map(e => e.payload.data).should.eql(["progress 10%\r", "progress 100%\r", "tail"]);
            done();
        }).catch(done);

        mockProcess.stdout.emit('data',"progress 10%\rprog");
        mockProcess.stdout.emit('data',"ress 100%\rtail");
        mockProcess.emit('close',0);
    })

    it("hides the given literal secrets in the event-log (#45)", function(done) {
        exec.run("git",["clone","--","https://user:pa/ss@host/r.git"],{},true,["user:pa/ss","pa/ss"]).then(function() {
            var text = JSON.stringify(logEvents);
            text.should.not.containEql("pa/ss");
            text.should.containEql("https://***@host/r.git");
            done();
        }).catch(done);

        mockProcess.stdout.emit('data',"Cloning into 'https://user:pa/ss@host/r.git'\n");
        mockProcess.emit('close',0);
    })

    describe("a line longer than the limit (SEC-009)", function() {
        function run(chunks, done, check) {
            exec.run("git",["fetch"],{},true).then(function() {
                check();
                done();
            }).catch(done);
            chunks.forEach(c => mockProcess.stdout.emit('data',c));
            mockProcess.emit('close',0);
        }
        function logged() {
            return logEvents.filter(e => e.payload.type === "out").map(e => e.payload.data);
        }

        it("is cut at its last white space: a URL at the boundary is not cut", function(done) {
            // 65540 characters of words, then the start of a URL that ends in the next chunk
            run(["word ".repeat(13108) + "see https://user:s3c", "ret@host/r.git end\n"], done, function() {
                var text = logged().join("");
                text.should.not.containEql("s3c");
                text.should.not.containEql("ret@host");
                text.should.containEql("see https://***@host/r.git end\n");
            });
        });

        it("#63 B2-AC-3: one chunk of words without a newline is cut after a white space, nothing is lost", function(done) {
            var input = "word ".repeat(14000);
            run([input], done, function() {
                var events = logged();
                events.length.should.be.above(1);
                // the cut falls at a white space (it would fall inside a word at the limit of 65904 characters)
                events[0].should.endWith(" ");
                events[0].length.should.be.below(input.length);
                events.join("").should.equal(input);
            });
        });

        it("without white space the last 4 KB stay pending: a URL near the end is completed by the next chunk", function(done) {
            run(["a".repeat(70000) + "https://user:s3c", "ret@host/r.git\n"], done, function() {
                var text = logged().join("");
                text.should.not.containEql("s3c");
                text.should.not.containEql("ret@host");
                text.should.containEql("a".repeat(100) + "https://***@host/r.git\n");
                // nothing is lost
                text.length.should.equal(70000 + "https://***@host/r.git\n".length);
            });
        });

        it("a complete URL that the cut would fall into is masked before the cut (SEC-009b)", function(done) {
            // the URL is in one chunk, no white space; KEEP_TAIL (4096) before the end lies inside it
            var chunk = "x".repeat(61500) + "https://user:s3cret@host/" + "y".repeat(4085);
            run([chunk], done, function() {
                var text = logged().join("");
                text.should.not.containEql("s3cret");
                text.should.not.containEql("user:s");
                text.should.containEql("https://***@host/");
                text.length.should.equal(chunk.length - "user:s3cret".length + "***".length);
            });
        });

        it("a complete URL with a bare token at the cut is masked too", function(done) {
            var chunk = "x".repeat(61520) + "https://t0k3n-abcdef@host/" + "y".repeat(4085);
            run([chunk], done, function() {
                var text = logged().join("");
                text.should.not.containEql("t0k3n");
                text.should.not.containEql("abcdef");
            });
        });

        it("a literal secret with a space is not cut at its space (SEC-009b)", function(done) {
            // the last white space of the buffer is the space inside the old user info
            var chunk = "x".repeat(65530) + " https://user:Summer 2024@host/r" + "y".repeat(10);
            exec.run("git",["fetch"],{},true,["user:Summer 2024","Summer 2024"]).then(function() {
                var text = logged().join("");
                text.should.not.containEql("Summer");
                text.should.not.containEql("2024");
                text.should.containEql("https://***@host/r");
                done();
            }).catch(done);
            mockProcess.stdout.emit('data',chunk);
            mockProcess.emit('close',0);
        });

        it("a literal secret with a space at the cut of a buffer of words (SEC-009b)", function(done) {
            // many words, so the cut looks for a white space; the secret is where the last one is
            var chunk = "w ".repeat(33000) + "https://user:Summer 2024@host/r" + "z".repeat(10);
            exec.run("git",["fetch"],{},true,["user:Summer 2024","Summer 2024"]).then(function() {
                var text = logged().join("");
                text.should.not.containEql("Summer");
                text.should.not.containEql("2024");
                text.should.containEql("https://***@host/r");
                done();
            }).catch(done);
            mockProcess.stdout.emit('data',chunk);
            mockProcess.emit('close',0);
        });

        it("a literal secret split between two chunks near the cut is completed and masked", function(done) {
            var first = "w ".repeat(33000) + "https://user:Summer 20";
            exec.run("git",["fetch"],{},true,["user:Summer 2024","Summer 2024"]).then(function() {
                var text = logged().join("");
                text.should.not.containEql("Summer");
                text.should.not.containEql("2024");
                text.should.containEql("https://***@host/r");
                done();
            }).catch(done);
            mockProcess.stdout.emit('data',first);
            mockProcess.stdout.emit('data',"24@host/r\n");
            mockProcess.emit('close',0);
        });

        it("the output is complete and in order", function(done) {
            var a = "x ".repeat(40000);
            run([a, a + "\n"], done, function() {
                logged().join("").should.equal(a + a + "\n");
            });
        });
    });

    it("runs command and rejects on error - close", function(done) {
        var command = "cmd";
        var args = [1,2,3];
        var opts = { a: true };
        exec.run(command,args,opts).then(function() {
            done("Command should have rejected");
        }).catch(function(result) {
            result
            result.code.should.eql(123);
            result.stdout.should.eql("123");
            result.stderr.should.eql("abc");
            done();
        }).catch(done);

        mockProcess.stdout.emit('data',"1");
        mockProcess.stderr.emit('data',"a");
        mockProcess.stderr.emit('data',"b");
        mockProcess.stdout.emit('data',"2");
        mockProcess.stdout.emit('data',"3");
        mockProcess.stderr.emit('data',"c");
        mockProcess.emit('close',123);
    })

    it("runs command and rejects on error - error", function(done) {
        var command = "cmd";
        var args = [1,2,3];
        var opts = { a: true };
        exec.run(command,args,opts).then(function() {
            done("Command should have rejected");
        }).catch(function(result) {
            result
            result.code.should.eql(456);
            result.stdout.should.eql("");
            result.stderr.should.eql("test-error");
            done();
        }).catch(done);

        mockProcess.emit('error',"test-error");
        mockProcess.emit('close',456);
    })

});
