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
 *   new tests (#45): maskUrlCredentials
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
var should = require("should");

var NR_TEST_UTILS = require("nr-test-utils");

var nodeRedUtil = NR_TEST_UTILS.require("@node-red/util");
var maskUrlCredentials = nodeRedUtil.maskUrlCredentials;

describe("@node-red/util/maskUrl", function() {
    it('is internal: not a member of util.util (RED.util of the nodes)', function() {
        maskUrlCredentials.should.be.a.Function();
        nodeRedUtil.util.should.not.have.property("maskUrlCredentials");
    });
    it('hides user:password of an http(s) URL', function() {
        maskUrlCredentials("fatal: unable to access 'https://user:s3cret@host.example/org/repo.git/': error")
            .should.equal("fatal: unable to access 'https://***@host.example/org/repo.git/': error");
        maskUrlCredentials("http://user:s3cret@host:8080/r.git").should.equal("http://***@host:8080/r.git");
    });
    it('hides a bare token', function() {
        maskUrlCredentials("https://ghp_abc123@github.com/org/repo.git").should.equal("https://***@github.com/org/repo.git");
    });
    it('hides a password with an unencoded @ up to the last @ of the authority', function() {
        maskUrlCredentials("https://user:p@ss@host/r.git").should.equal("https://***@host/r.git");
    });
    it('hides every URL of a text', function() {
        var masked = maskUrlCredentials("a https://u1:p1@h1/x\nb http://tok@h2/y c ssh://u3:p3@h3/z");
        masked.should.equal("a https://***@h1/x\nb http://***@h2/y c ssh://***@h3/z");
    });
    it('hides a password of an ssh URL but not its bare user', function() {
        maskUrlCredentials("ssh://user:s3cret@host/r.git").should.equal("ssh://***@host/r.git");
        maskUrlCredentials("git+ssh://user:s3cret@host/r.git").should.equal("git+ssh://***@host/r.git");
        maskUrlCredentials("ssh://git@host/org/repo.git").should.equal("ssh://git@host/org/repo.git");
    });
    it('treats the scheme case-insensitively: SSH://git@host is not changed, SSH://u:p@host is', function() {
        maskUrlCredentials("SSH://git@host/org/repo.git").should.equal("SSH://git@host/org/repo.git");
        maskUrlCredentials("Git+SSH://git@host/org/repo.git").should.equal("Git+SSH://git@host/org/repo.git");
        maskUrlCredentials("SSH://user:s3cret@host/r.git").should.equal("SSH://***@host/r.git");
        maskUrlCredentials("HTTPS://token@host/r.git").should.equal("HTTPS://***@host/r.git");
    });
    it('does not change a URL without credentials', function() {
        var text = "fatal: unable to access 'https://github.com/org/repo.git/': Could not resolve host";
        maskUrlCredentials(text).should.equal(text);
        maskUrlCredentials("https://host/path@with-at").should.equal("https://host/path@with-at");
        maskUrlCredentials("https://host/a b@c").should.equal("https://host/a b@c");
    });
    it('does not change an scp-like URL', function() {
        var text = "fatal: Could not read from remote repository git@github.com:org/repo.git";
        maskUrlCredentials(text).should.equal(text);
        maskUrlCredentials("user@host:path/repo.git").should.equal("user@host:path/repo.git");
    });
    it('returns a value that is not a string as it is', function() {
        should.not.exist(maskUrlCredentials(undefined));
        should.not.exist(maskUrlCredentials(null));
        maskUrlCredentials(5).should.equal(5);
    });
    describe('literal secrets', function() {
        it('hides a password the pattern cannot recognise (an unescaped / or a space)', function() {
            // without the secrets the pattern misses both
            maskUrlCredentials("https://user:pa/ss@host/r").should.containEql("pa/ss");
            maskUrlCredentials("https://user:pa ss@host/r").should.containEql("pa ss");
            maskUrlCredentials("https://user:pa/ss@host/r", ["user:pa/ss", "pa/ss"]).should.equal("https://***@host/r");
            maskUrlCredentials("https://user:pa ss@host/r and pa ss", ["user:pa ss", "pa ss"]).should.equal("https://***@host/r and ***");
        });
        it('replaces the longest secret first and ignores values that are not strings or empty', function() {
            maskUrlCredentials("x user:pw y pw", ["pw", "user:pw", "", 5, null]).should.equal("x *** y ***");
        });
        it('does not change a text that has none of the secrets', function() {
            maskUrlCredentials("nothing here", ["s3cret"]).should.equal("nothing here");
        });
    });
    describe('performance', function() {
        function time(text) {
            var start = process.hrtime.bigint();
            maskUrlCredentials(text);
            return Number(process.hrtime.bigint() - start) / 1e6;
        }
        it('is linear in the worst cases (the same work for n and 4n, below 300 ms)', function() {
            var n = 50000;
            [
                // a bounded scheme then "://" then user info without an "@"
                function(k) { return "a".repeat(16) + "://" + "x".repeat(k); },
                function(k) { return "https://" + "a:".repeat(k); },
                function(k) { return "https://".repeat(k); },
                function(k) { return "a://".repeat(k) + "@"; },
                function(k) { return "a".repeat(k); },
                function(k) { return "https://" + "@".repeat(k); }
            ].forEach(function(make, i) {
                time(make(1000)); // warm up
                var small = time(make(n));
                var large = time(make(4 * n));
                small.should.be.below(300, "case " + i + " n");
                large.should.be.below(300, "case " + i + " 4n");
            });
            time("a".repeat(16) + "://" + "x".repeat(200000)).should.be.below(300);
        });
    });
});
