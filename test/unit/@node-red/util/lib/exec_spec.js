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
 *   lines (one event per line and stream instead of one per chunk)
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
