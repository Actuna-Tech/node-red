/**
 * Copyright OpenJS Foundation and other contributors, https://openjsf.org/
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
 *   #63: tests of the jQuery stand-in: the places that parse a string as HTML are recorded in `htmlSinks`
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

const should = require("should");

const { createJQuery } = require("./jquery");

describe("editor-client/helpers/jquery (#63, B1-AC-5)", function() {
    let jq;

    beforeEach(function() {
        jq = createJQuery();
    });

    function recorded() {
        return jq.record.htmlSinks.map(s => s.html);
    }

    it("records the string given to .replaceWith()", function() {
        const el = jq("<div>");
        const before = jq.record.htmlSinks.length;
        el.replaceWith("<b>1</b>");
        recorded().slice(before).should.eql(["<b>1</b>"]);
    });

    it("records the string given to .wrap(), .wrapAll() and .wrapInner()", function() {
        const el = jq("<div>");
        const before = jq.record.htmlSinks.length;
        el.wrap("<i>1</i>");
        el.wrapAll("<i>2</i>");
        el.wrapInner("<i>3</i>");
        recorded().slice(before).should.eql(["<i>1</i>", "<i>2</i>", "<i>3</i>"]);
    });

    it("records the string given to $.parseHTML()", function() {
        const before = jq.record.htmlSinks.length;
        jq.parseHTML("<u>1</u>");
        recorded().slice(before).should.eql(["<u>1</u>"]);
    });

    it("records the html property of $(\"<div>\", {html: s}) in addition to the tag itself", function() {
        const before = jq.record.htmlSinks.length;
        jq("<div>", { html: "<s>1</s>" });
        const added = recorded().slice(before);
        added.should.containEql("<s>1</s>");
        added.filter(h => h === "<s>1</s>").should.have.length(1);
    });

    it("has one entry per call", function() {
        const el = jq("<div>");
        const before = jq.record.htmlSinks.length;
        el.replaceWith("<b>1</b>");
        el.wrap("<i>");
        el.wrapAll("<i>");
        el.wrapInner("<i>");
        jq.parseHTML("<u>");
        jq.record.htmlSinks.length.should.equal(before + 5);
    });

    it("does not record an element that is given instead of a string", function() {
        const el = jq("<div>");
        const other = jq("<span>");
        const before = jq.record.htmlSinks.length;
        el.replaceWith(other);
        el.wrap(other);
        el.wrapAll(other);
        el.wrapInner(other);
        jq("<p>", { html: other });
        jq.record.htmlSinks.slice(before).map(s => s.html).should.not.containEql("[object Object]");
        // only the tag of `$("<p>")` itself is recorded; nothing for the element arguments
        jq.record.htmlSinks.length.should.equal(before + 1);
    });

    it("keeps the entries of a single element in its own state", function() {
        const el = jq("<div>");
        const count = el.state.htmlSinks.length;
        el.replaceWith("<b>1</b>");
        el.state.htmlSinks.should.have.length(count + 1);
        el.state.htmlSinks[count].html.should.equal("<b>1</b>");
    });
});
