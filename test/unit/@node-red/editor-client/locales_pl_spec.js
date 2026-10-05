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
 *   Z-13: consistency tests of the partial Polish (pl) message catalogs
 *   #37: the texts of a failed install, update, remove, enable and disable of a module are in pl
 *   Z-06 (#10): the texts of the errors of the preDeploy hook are in pl
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");
const fs = require("fs");
const path = require("path");

const NR_TEST_UTILS = require("nr-test-utils");

const catalogs = {
    "editor.json": "@node-red/editor-client/locales",
    "messages.json": "@node-red/nodes/locales"
};

// pl uses the Intl plural categories, the base key is the fallback of calls without count
const PLURAL_SUFFIX = /_(one|few|many|other)$/;

function load(pkg, lang, file) {
    return JSON.parse(fs.readFileSync(NR_TEST_UTILS.resolve(pkg + "/" + lang + "/" + file)));
}

function flatten(obj, prefix, out) {
    Object.keys(obj).forEach(function(k) {
        const key = prefix ? prefix + "." + k : k;
        if (obj[k] && typeof obj[k] === "object") {
            flatten(obj[k], key, out);
        } else {
            out[key] = obj[k];
        }
    });
    return out;
}

function placeholders(value) {
    return (String(value).match(/__[^_\s]+?__|<[^>]+>/g) || []).sort().join("|");
}

describe("locales/pl", function() {
    Object.keys(catalogs).forEach(function(file) {
        describe(file, function() {
            let en, pl;
            before(function() {
                en = flatten(load(catalogs[file], "en-US", file), "", {});
                pl = flatten(load(catalogs[file], "pl", file), "", {});
            });

            it("contains only keys that exist in en-US", function() {
                const extra = Object.keys(pl).filter(function(k) {
                    return !(k in en) && !(PLURAL_SUFFIX.test(k) && (k.replace(PLURAL_SUFFIX, "") in en));
                });
                extra.should.eql([]);
            });

            it("keeps the placeholders and the HTML tags of en-US", function() {
                const different = Object.keys(pl).filter(function(k) {
                    return (k in en) && placeholders(en[k]) !== placeholders(pl[k]);
                });
                different.should.eql([]);
            });

            it("has no empty translation where en-US has text", function() {
                const empty = Object.keys(pl).filter(function(k) {
                    return pl[k] === "" && en[k] !== "";
                });
                empty.should.eql([]);
            });
        });
    });

    it("has the texts of the failures of the palette (install, update, remove, enable, disable; #37)", function() {
        const pl = flatten(load(catalogs["editor.json"], "pl", "editor.json"), "", {});
        ["install", "update", "remove", "enable", "disable"].forEach(function(action) {
            pl.should.have.property("palette.editor.errors." + action + "Failed");
        });
    });

    it("has the texts of the errors of the preDeploy hook (rejected, hookTimeout, hookFailed; Z-06)", function() {
        const en = flatten(load(catalogs["editor.json"], "en-US", "editor.json"), "", {});
        const pl = flatten(load(catalogs["editor.json"], "pl", "editor.json"), "", {});
        ["rejected", "hookTimeout", "hookFailed"].forEach(function(name) {
            const key = "deploy.errors." + name;
            en.should.have.property(key);
            pl.should.have.property(key);
            pl[key].should.not.equal(en[key]);
        });
        placeholders(pl["deploy.errors.rejected"]).should.equal("__message__");
    });

    it("is registered in the language list of the editor", function() {
        load("@node-red/editor-client/locales", "en-US", "editor.json").languages.should.have.property("pl", "Polski");
    });

    it("is found by the language detection of the runtime", function() {
        const i18n = NR_TEST_UTILS.require("@node-red/util").i18n;
        i18n.init({});
        return i18n.registerMessageCatalog("z13-pl-test", NR_TEST_UTILS.resolve("@node-red/editor-client/locales"), "editor.json").then(function() {
            i18n.availableLanguages("z13-pl-test").should.containEql("pl");
        });
    });
});
