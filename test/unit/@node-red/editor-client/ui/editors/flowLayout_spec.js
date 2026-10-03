/*
 * Modified by Actuna Sp. z o.o.:
 *   FL-B-005: tests for keeping unknown flow layout values in the flow layout form
 *   Z-14: tests for the flow layout form with editorTheme.flowLayout.enabled set and unset
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
const should = require("should");

const NR_TEST_UTILS = require("nr-test-utils");

const flowLayoutModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/editors/flowLayout.js");
const viewLayoutModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/view-layout.js");

/**
 * A minimal stand-in for the parts of jQuery used by the flow layout form.
 * A single select behaves like the browser: setting a value that has no
 * matching option leaves nothing selected and val() then returns null.
 */
function createFakeJQuery() {
    const elementsById = {};
    function wrap(el) {
        const w = {
            length: el ? 1 : 0,
            el: el,
            appendTo: function(parent) {
                parent.el.children.push(el);
                if (el.tag === "option" && parent.el.tag === "select") {
                    parent.el.options.push(el);
                    if (parent.el.selected === undefined) {
                        parent.el.selected = el;
                    }
                }
                return w;
            },
            attr: function(name, value) {
                el.attrs[name] = value;
                if (name === "id") {
                    elementsById[value] = el;
                }
                return w;
            },
            text: function(t) { el.text = t; return w },
            prepend: function() { return w },
            addClass: function() { return w },
            css: function() { return w },
            val: function(v) {
                if (arguments.length === 0) {
                    if (el.tag === "select") {
                        return el.selected ? el.selected.value : null;
                    }
                    return el.value;
                }
                if (el.tag === "select") {
                    el.selected = el.options.find(function(o) { return o.value === String(v) }) || null;
                } else {
                    el.value = String(v);
                }
                return w;
            }
        };
        return w;
    }
    const $ = function(arg) {
        if (typeof arg === "string" && arg[0] === "<") {
            const tag = /^<([a-z]+)/.exec(arg)[1];
            return wrap({ tag: tag, attrs: {}, children: [], options: [] });
        }
        if (typeof arg === "string" && arg[0] === "#") {
            return wrap(elementsById[arg.substring(1)]);
        }
        throw new Error("Unsupported selector: " + arg);
    };
    $.optionsOf = function(id) {
        return elementsById[id].options.map(function(o) { return { val: o.value, text: o.text } });
    };
    return $;
}

describe("editor-client/ui/editors/flowLayout", function() {
    let form;
    let redraws;
    let flowLayoutEnabled;

    beforeEach(function() {
        redraws = 0;
        flowLayoutEnabled = true;
        global.$ = createFakeJQuery();
        global.RED = {
            editor: {},
            settings: {
                theme: function(property, defaultValue) {
                    return property === "flowLayout.enabled" ? flowLayoutEnabled : defaultValue;
                }
            },
            _: function(key, opts) { return key + (opts ? JSON.stringify(opts) : "") },
            view: {
                redraw: function() { redraws++ },
                layout: {
                    layoutOptions: function() {
                        return [{ val: "LR", text: "lr" }, { val: "TB", text: "tb" }, { val: "auto", text: "auto" }];
                    },
                    wireStyleOptions: function() {
                        return [{ val: "curved", text: "curved" }, { val: "orthogonal", text: "orthogonal" }];
                    }
                }
            }
        };
        delete require.cache[viewLayoutModulePath];
        delete require.cache[flowLayoutModulePath];
        require(viewLayoutModulePath);
        require(flowLayoutModulePath);
        form = $('<div>');
    });

    afterEach(function() {
        delete global.RED;
        delete global.$;
        delete require.cache[viewLayoutModulePath];
        delete require.cache[flowLayoutModulePath];
    });

    function editState() {
        return { changes: {}, changed: false };
    }

    describe("unknown values (FL-B-005)", function() {
        it("keeps an unknown layout and wire style when the form is applied unchanged", function() {
            const flow = { id: "t1", type: "tab", layout: "XY", wireStyle: "zigzag" };
            RED.editor.flowLayout.create(form, flow);
            const state = editState();
            RED.editor.flowLayout.apply(flow, state).should.be.false();
            flow.should.have.property("layout", "XY");
            flow.should.have.property("wireStyle", "zigzag");
            state.changed.should.be.false();
            state.changes.should.eql({});
            redraws.should.equal(0);
        });

        it("shows an unknown value as its own selected option", function() {
            const flow = { id: "t1", type: "tab", layout: "XY" };
            RED.editor.flowLayout.create(form, flow);
            const options = $.optionsOf("node-input-flow-layout");
            options.map(function(o) { return o.val }).should.eql(["", "LR", "TB", "auto", "XY"]);
            options[4].text.should.equal('layout.unknownValue{"value":"XY"}');
            $("#node-input-flow-layout").val().should.equal("XY");
            // No extra option for a known or unset value
            $.optionsOf("node-input-flow-wire-style").map(function(o) { return o.val }).should.eql(["", "curved", "orthogonal"]);
        });

        it("changes an unknown value when the user selects another value", function() {
            const flow = { id: "t1", type: "tab", layout: "XY" };
            RED.editor.flowLayout.create(form, flow);
            $("#node-input-flow-layout").val("TB");
            const state = editState();
            RED.editor.flowLayout.apply(flow, state).should.be.true();
            flow.should.have.property("layout", "TB");
            state.changes.should.have.property("layout", "XY");
            state.changed.should.be.true();
        });

        it("removes an unknown value when the user selects the editor default", function() {
            const flow = { id: "t1", type: "tab", layout: "XY" };
            RED.editor.flowLayout.create(form, flow);
            $("#node-input-flow-layout").val("");
            const state = editState();
            RED.editor.flowLayout.apply(flow, state).should.be.true();
            flow.should.not.have.property("layout");
            state.changes.should.have.property("layout", "XY");
        });

        it("keeps a non-string value when the form is applied unchanged", function() {
            const flow = { id: "t1", type: "tab", layout: 5 };
            RED.editor.flowLayout.create(form, flow);
            const state = editState();
            RED.editor.flowLayout.apply(flow, state).should.be.false();
            flow.should.have.property("layout", 5);
        });
    });

    describe("known values", function() {
        it("leaves a flow without layout options unchanged", function() {
            const flow = { id: "t1", type: "tab" };
            RED.editor.flowLayout.create(form, flow);
            const state = editState();
            RED.editor.flowLayout.apply(flow, state).should.be.false();
            flow.should.not.have.property("layout");
            flow.should.not.have.property("wireStyle");
        });

        it("applies a selected layout and wire style", function() {
            const flow = { id: "t1", type: "tab", layout: "LR" };
            RED.editor.flowLayout.create(form, flow);
            $("#node-input-flow-layout").val("TB");
            $("#node-input-flow-wire-style").val("orthogonal");
            const state = editState();
            RED.editor.flowLayout.apply(flow, state).should.be.true();
            flow.should.have.properties({ layout: "TB", wireStyle: "orthogonal" });
            state.changes.should.have.property("layout", "LR");
            state.changes.should.have.property("wireStyle", undefined);
            redraws.should.equal(1);
        });
    });

    describe("editorTheme.flowLayout.enabled (Z-14)", function() {
        it("adds no form rows when disabled", function() {
            flowLayoutEnabled = false;
            const flow = { id: "t1", type: "tab", layout: "TB" };
            RED.editor.flowLayout.create(form, flow);
            form.el.children.should.have.length(0);
            $("#node-input-flow-layout").length.should.equal(0);
            $("#node-input-flow-wire-style").length.should.equal(0);
        });

        it("keeps the layout options of a flow when disabled", function() {
            flowLayoutEnabled = false;
            const flow = { id: "t1", type: "tab", layout: "TB", wireStyle: "orthogonal" };
            RED.editor.flowLayout.create(form, flow);
            const state = editState();
            RED.editor.flowLayout.apply(flow, state).should.be.false();
            flow.should.have.properties({ layout: "TB", wireStyle: "orthogonal" });
            state.changed.should.be.false();
            state.changes.should.eql({});
            redraws.should.equal(0);
        });

        it("treats a missing setting as disabled", function() {
            flowLayoutEnabled = undefined;
            RED.editor.flowLayout.create(form, { id: "t1", type: "tab" });
            form.el.children.should.have.length(0);
        });

        it("adds the form rows when enabled", function() {
            RED.editor.flowLayout.create(form, { id: "t1", type: "tab" });
            form.el.children.should.have.length(2);
            $("#node-input-flow-layout").length.should.equal(1);
        });
    });
});
