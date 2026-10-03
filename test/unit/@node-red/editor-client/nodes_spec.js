/*
 * Modified by Actuna Sp. z o.o.:
 *   FL-B-009: tests for exporting the effective editor default layout of flows
 *   FL-B-009: tests for matching an imported subflow exported with the editor default layout
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
const should = require("should");

const NR_TEST_UTILS = require("nr-test-utils");

const nodesModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/nodes.js");
const viewLayoutModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/view-layout.js");

describe("editor-client/nodes", function() {
    let viewSettings;

    beforeEach(function() {
        viewSettings = {};
        global.RED = {
            settings: {
                get: function(key) {
                    return key === "editor" ? { view: viewSettings } : undefined;
                }
            },
            events: { emit: function() {}, on: function() {} },
            utils: { validateTypedProperty: function() { return true; } },
            _: function(key) { return key; }
        };
        delete require.cache[viewLayoutModulePath];
        delete require.cache[nodesModulePath];
        require(viewLayoutModulePath);
        require(nodesModulePath);
    });

    afterEach(function() {
        delete global.RED;
        delete require.cache[viewLayoutModulePath];
        delete require.cache[nodesModulePath];
    });

    function tab(props) {
        return Object.assign({ id: "t1", type: "tab", label: "Flow 1", disabled: false, info: "", env: [], _def: RED.nodes.getType("tab") }, props || {});
    }

    function subflow(props) {
        return Object.assign({ id: "s1", type: "subflow", name: "Subflow 1", info: "", in: [], out: [], env: [] }, props || {});
    }

    function exportFlow(flow, opts) {
        const result = RED.nodes.createExportableNodeSet([flow], opts);
        result.should.have.length(1);
        return result[0];
    }

    describe("flow layout options on export (FL-B-009)", function() {
        it("exports a tab without layout options unchanged by default", function() {
            viewSettings["view-flow-layout"] = "TB";
            viewSettings["view-wire-style"] = "orthogonal";
            const result = exportFlow(tab());
            result.should.not.have.property("layout");
            result.should.not.have.property("wireStyle");
            RED.nodes.convertNode(tab()).should.not.have.property("layout");
        });

        it("exports the editor default layout of a tab when requested", function() {
            viewSettings["view-flow-layout"] = "TB";
            viewSettings["view-wire-style"] = "orthogonal";
            const result = exportFlow(tab(), { flowLayoutDefaults: true });
            result.should.have.property("layout", "TB");
            result.should.have.property("wireStyle", "orthogonal");
            RED.nodes.convertNode(tab(), { flowLayoutDefaults: true }).should.have.property("layout", "TB");
        });

        it("does not add layout options when the editor defaults are used", function() {
            const result = exportFlow(tab(), { flowLayoutDefaults: true });
            result.should.not.have.property("layout");
            result.should.not.have.property("wireStyle");
            viewSettings["view-flow-layout"] = "LR";
            viewSettings["view-wire-style"] = "curved";
            const result2 = exportFlow(tab(), { flowLayoutDefaults: true });
            result2.should.not.have.property("layout");
            result2.should.not.have.property("wireStyle");
        });

        it("keeps the layout options set on a tab", function() {
            viewSettings["view-flow-layout"] = "TB";
            exportFlow(tab({ layout: "LR", wireStyle: "curved" }), { flowLayoutDefaults: true })
                .should.have.properties({ layout: "LR", wireStyle: "curved" });
            exportFlow(tab({ layout: "auto" }))
                .should.have.property("layout", "auto");
        });

        it("does not modify the tab", function() {
            viewSettings["view-flow-layout"] = "TB";
            const flow = tab();
            exportFlow(flow, { flowLayoutDefaults: true });
            flow.should.not.have.property("layout");
        });

        it("exports a subflow without layout options unchanged by default", function() {
            viewSettings["view-flow-layout"] = "TB";
            const result = exportFlow(subflow());
            result.should.have.property("type", "subflow");
            result.should.not.have.property("layout");
            result.should.not.have.property("wireStyle");
        });

        it("exports the editor default layout of a subflow when requested", function() {
            viewSettings["view-flow-layout"] = "auto";
            viewSettings["view-wire-style"] = "orthogonal";
            exportFlow(subflow(), { flowLayoutDefaults: true })
                .should.have.properties({ layout: "auto", wireStyle: "orthogonal" });
            exportFlow(subflow({ layout: "LR" }), { flowLayoutDefaults: true })
                .should.have.properties({ layout: "LR", wireStyle: "orthogonal" });
        });

        it("exports the editor default layout in the complete node set when requested", function() {
            viewSettings["view-flow-layout"] = "TB";
            RED.events = { emit: function() {}, on: function() {} };
            RED.nodes.addWorkspace(tab());
            const exported = RED.nodes.createCompleteNodeSet({ flowLayoutDefaults: true });
            exported.filter(function(n) { return n.id === "t1" })[0].should.have.property("layout", "TB");
            const plain = RED.nodes.createCompleteNodeSet();
            plain.filter(function(n) { return n.id === "t1" })[0].should.not.have.property("layout");
        });
    });
    describe("matching an imported subflow (FL-B-009)", function() {
        function exportSubflow(opts) {
            return RED.nodes.createExportableNodeSet([RED.nodes.subflow("s1")], opts);
        }

        it("matches the existing subflow when the export carries the editor default layout", function() {
            viewSettings["view-flow-layout"] = "TB";
            RED.nodes.addSubflow(subflow());
            const exported = exportSubflow({ flowLayoutDefaults: true });
            exported[0].should.have.property("layout", "TB");
            const imported = Object.assign({}, exported[0], { id: "s2" });
            const match = RED.nodes.checkForMatchingSubflow(imported, []);
            should.exist(match);
            match.should.have.property("id", "s1");
        });

        it("matches the existing subflow when the export has no layout options", function() {
            viewSettings["view-flow-layout"] = "TB";
            RED.nodes.addSubflow(subflow());
            const exported = exportSubflow();
            exported[0].should.not.have.property("layout");
            const imported = Object.assign({}, exported[0], { id: "s2" });
            const match = RED.nodes.checkForMatchingSubflow(imported, []);
            should.exist(match);
            match.should.have.property("id", "s1");
        });

        it("does not match a subflow with a different layout", function() {
            RED.nodes.addSubflow(subflow());
            const exported = exportSubflow();
            const imported = Object.assign({}, exported[0], { id: "s2", layout: "TB" });
            should.not.exist(RED.nodes.checkForMatchingSubflow(imported, []));
        });
    });
});
