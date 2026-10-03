/*
 * Modified by Actuna Sp. z o.o.:
 *   FL-B-009: tests for exporting the effective editor default layout of flows
 *   FL-B-009: tests for matching an imported subflow exported with the editor default layout
 *   FL-B-010: tests for replacing a flow with the same id on import
 *   FL-B-010: tests for replacing a flow after the rest of the import, copies, change flags and failures
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
            utils: { validateTypedProperty: function() { return true; }, clearNodeColorCache: function() {} },
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

    describe("replacing a flow on import (FL-B-010)", function() {
        let activeWorkspace;
        let events;

        beforeEach(function() {
            activeWorkspace = "t1";
            events = [];
            RED.events = {
                emit: function(name, obj) { events.push({ name: name, obj: obj }); },
                on: function() {}
            };
            RED.workspaces = {
                active: function() { return activeWorkspace; },
                add: function() {},
                refresh: function() {},
                contains: function(id) { return !!RED.nodes.workspace(id); }
            };
            RED.editor = { validateNode: function() {} };
            RED.group = {
                markDirty: function() {},
                def: { defaults: { name: { value: "" }, style: { value: { label: true } }, nodes: { value: [] }, env: { value: [] } }, category: "config" }
            };
            RED.notify = function() {};
            RED.view = { redraw: function() {} };
            RED.nodes.setNodeList([{
                id: "node-red/test", module: "node-red", name: "test", enabled: true,
                types: ["test-node", "test-config", "link in", "link out"]
            }]);
            RED.nodes.registerType("test-config", { category: "config", defaults: { name: { value: "" } } });
            RED.nodes.registerType("test-node", {
                category: "function", inputs: 1, outputs: 1,
                defaults: { name: { value: "" }, cfg: { value: "", type: "test-config", required: false } }
            });
            RED.nodes.registerType("link in", { category: "common", inputs: 0, outputs: 1, defaults: { name: { value: "" }, links: { value: [] } } });
            RED.nodes.registerType("link out", { category: "common", inputs: 1, outputs: 0, defaults: { name: { value: "" }, links: { value: [] } } });
        });

        function existingFlows() {
            return [
                { id: "t1", type: "tab", label: "Local", info: "local info", disabled: false, env: [{ name: "A", type: "str", value: "1" }], layout: "LR", wireStyle: "orthogonal" },
                { id: "t2", type: "tab", label: "Other", info: "", disabled: false, env: [] },
                { id: "c1", type: "test-config", z: "t1", name: "local config" },
                { id: "g1", type: "group", z: "t1", name: "local group", nodes: ["n1"], x: 10, y: 10, w: 200, h: 100, style: {} },
                { id: "n1", type: "test-node", z: "t1", g: "g1", name: "local 1", cfg: "c1", x: 100, y: 50, wires: [["j1"]] },
                { id: "j1", type: "junction", z: "t1", x: 200, y: 50, wires: [["n2"]] },
                { id: "n2", type: "test-node", z: "t1", name: "local 2", x: 300, y: 50, wires: [[]] },
                { id: "li1", type: "link in", z: "t1", name: "in", links: ["lo2"], x: 100, y: 150, wires: [["n2"]] },
                { id: "lo2", type: "link out", z: "t2", name: "out", links: ["li1"], x: 100, y: 150, wires: [] },
                { id: "m2", type: "test-node", z: "t2", name: "other", x: 300, y: 150, wires: [[]] }
            ];
        }

        function importedFlow() {
            return [
                { id: "t1", type: "tab", label: "Imported", info: "imported info", disabled: true, env: [], layout: "TB" },
                { id: "n1", type: "test-node", z: "t1", name: "imported 1", x: 100, y: 50, wires: [["n3"]] },
                { id: "n3", type: "test-node", z: "t1", name: "imported 3", x: 100, y: 150, wires: [[]] },
                { id: "li1", type: "link in", z: "t1", name: "in", links: ["lo2"], x: 100, y: 250, wires: [["n3"]] }
            ];
        }

        function replaceMap(nodes) {
            const importMap = {};
            nodes.forEach(function(n) { importMap[n.id] = "replace"; });
            return importMap;
        }

        function idsOn(z) {
            const ids = RED.nodes.filterNodes({ z: z }).map(function(n) { return n.id; });
            RED.nodes.eachConfig(function(n) { if (n.z === z) { ids.push(n.id); } });
            RED.nodes.groups(z).forEach(function(g) { ids.push(g.id); });
            RED.nodes.junctions(z).forEach(function(j) { ids.push(j.id); });
            return ids.sort();
        }

        function wiresOf(id) {
            return RED.nodes.getNodeLinks(id, 0).map(function(l) { return l.target.id; }).sort();
        }

        it("replaces the properties and the content of an existing flow", function() {
            RED.nodes.import(existingFlows());
            const imported = importedFlow();
            const result = RED.nodes.import(imported, { importMap: replaceMap(imported) });

            const flow = RED.nodes.workspace("t1");
            flow.should.have.properties({ label: "Imported", info: "imported info", disabled: true, layout: "TB" });
            flow.env.should.eql([]);
            flow.should.not.have.property("wireStyle");
            RED.nodes.getWorkspaceOrder().should.eql(["t1", "t2"]);

            idsOn("t1").should.eql(["li1", "n1", "n3"]);
            RED.nodes.node("n1").should.have.property("name", "imported 1");
            RED.nodes.node("n1").should.not.have.property("g");
            wiresOf("n1").should.eql(["n3"]);
            should.not.exist(RED.nodes.node("c1"));
            should.not.exist(RED.nodes.group("g1"));
            should.not.exist(RED.nodes.junction("j1"));

            idsOn("t2").should.eql(["lo2", "m2"]);
            RED.nodes.node("lo2").links.should.eql(["li1"]);
            RED.nodes.node("li1").links.should.eql(["lo2"]);

            result.should.have.property("removedNodes");
            result.removedNodes.map(function(n) { return n.id; }).sort()
                .should.eql(["c1", "g1", "j1", "li1", "n1", "n2", "t1"]);
            result.removedNodes.filter(function(n) { return n.id === "t1"; })[0]
                .should.have.properties({ label: "Local", layout: "LR", wireStyle: "orthogonal" });
            result.nodes.should.have.length(0);
            result.workspaces.should.have.length(0);
        });

        it("restores the previous flow when the removed nodes are replaced back (undo)", function() {
            RED.nodes.import(existingFlows());
            const imported = importedFlow();
            const result = RED.nodes.import(imported, { importMap: replaceMap(imported) });

            const undo = RED.nodes.import(result.removedNodes, { importMap: replaceMap(result.removedNodes) });

            const flow = RED.nodes.workspace("t1");
            flow.should.have.properties({ label: "Local", info: "local info", disabled: false, layout: "LR", wireStyle: "orthogonal" });
            flow.env.should.eql([{ name: "A", type: "str", value: "1" }]);
            RED.nodes.getWorkspaceOrder().should.eql(["t1", "t2"]);
            idsOn("t1").should.eql(["c1", "g1", "j1", "li1", "n1", "n2"]);
            RED.nodes.node("n1").should.have.properties({ name: "local 1", g: "g1", cfg: "c1" });
            RED.nodes.group("g1").nodes.map(function(n) { return n.id; }).should.eql(["n1"]);
            wiresOf("n1").should.eql(["j1"]);
            wiresOf("j1").should.eql(["n2"]);
            RED.nodes.node("c1").users.map(function(n) { return n.id; }).should.eql(["n1"]);
            idsOn("t2").should.eql(["lo2", "m2"]);

            // redo
            undo.removedNodes.map(function(n) { return n.id; }).sort().should.eql(["li1", "n1", "n3", "t1"]);
            RED.nodes.import(undo.removedNodes, { importMap: replaceMap(undo.removedNodes) });
            RED.nodes.workspace("t1").should.have.property("label", "Imported");
            idsOn("t1").should.eql(["li1", "n1", "n3"]);
        });

        it("gives a new id to an imported node whose id is used in another flow", function() {
            RED.nodes.import(existingFlows());
            const imported = importedFlow();
            imported.push({ id: "m2", type: "test-node", z: "t1", name: "clash", x: 300, y: 250, wires: [["n1"]] });
            imported[1].wires = [["n3", "m2"]];
            RED.nodes.import(imported, { importMap: replaceMap(imported) });

            RED.nodes.node("m2").should.have.properties({ z: "t2", name: "other" });
            const onFlow = RED.nodes.filterNodes({ z: "t1" });
            onFlow.should.have.length(4);
            const clash = onFlow.filter(function(n) { return n.name === "clash"; })[0];
            should.exist(clash);
            clash.id.should.not.equal("m2");
            wiresOf("n1").should.eql([clash.id, "n3"].sort());
            wiresOf(clash.id).should.eql(["n1"]);
            idsOn("t2").should.eql(["lo2", "m2"]);
        });

        it("keeps a replaced flow locked only when the imported flow is locked", function() {
            const existing = existingFlows();
            existing[0].locked = true;
            RED.nodes.import(existing);
            const imported = importedFlow();
            RED.nodes.import(imported, { importMap: replaceMap(imported) });
            RED.nodes.workspace("t1").should.have.property("locked", false);
            idsOn("t1").should.eql(["li1", "n1", "n3"]);

            const locked = importedFlow();
            locked[0].locked = true;
            RED.nodes.import(locked, { importMap: replaceMap(locked) });
            RED.nodes.workspace("t1").should.have.property("locked", true);
            idsOn("t1").should.eql(["li1", "n1", "n3"]);
        });

        it("emits a flow change event for the replaced flow", function() {
            RED.nodes.import(existingFlows());
            events = [];
            const imported = importedFlow();
            RED.nodes.import(imported, { importMap: replaceMap(imported) });
            events.filter(function(e) { return e.name === "flows:change" && e.obj.id === "t1"; }).should.have.length(1);
            events.filter(function(e) { return e.name === "flows:add" || e.name === "flows:remove"; }).should.have.length(0);
        });

        it("keeps the instances of a subflow used in a replaced flow", function() {
            const existing = existingFlows();
            existing.push({ id: "sf1", type: "subflow", name: "Subflow", info: "", in: [], out: [], env: [] });
            existing.push({ id: "i1", type: "subflow:sf1", z: "t1", x: 100, y: 300, wires: [] });
            existing.push({ id: "i2", type: "subflow:sf1", z: "t2", x: 100, y: 300, wires: [] });
            RED.nodes.import(existing);
            RED.nodes.subflow("sf1").instances.map(function(n) { return n.id; }).sort().should.eql(["i1", "i2"]);

            const imported = importedFlow();
            imported.push({ id: "i3", type: "subflow:sf1", z: "t1", x: 100, y: 300, wires: [] });
            const result = RED.nodes.import(imported, { importMap: replaceMap(imported) });
            RED.nodes.subflow("sf1").instances.map(function(n) { return n.id; }).sort().should.eql(["i2", "i3"]);

            RED.nodes.import(result.removedNodes, { importMap: replaceMap(result.removedNodes) });
            RED.nodes.subflow("sf1").instances.map(function(n) { return n.id; }).sort().should.eql(["i1", "i2"]);
            RED.nodes.node("i1").should.have.property("z", "t1");
        });

        it("replaces a flow together with the subflow used in it", function() {
            RED.subflow = {
                removeSubflow: function(id) {
                    RED.nodes.filterNodes({ z: id }).forEach(function(n) { RED.nodes.remove(n.id); });
                    RED.nodes.removeSubflow(RED.nodes.subflow(id));
                }
            };
            const subflowDef = function(name) {
                return [
                    { id: "sf1", type: "subflow", name: name, info: "", in: [], out: [], env: [] },
                    { id: "sfn1", type: "test-node", z: "sf1", name: name, x: 100, y: 50, wires: [[]] }
                ];
            };
            const existing = existingFlows().concat(subflowDef("local"));
            existing.push({ id: "i1", type: "subflow:sf1", z: "t1", x: 100, y: 300, wires: [] });
            existing.push({ id: "i2", type: "subflow:sf1", z: "t2", x: 100, y: 300, wires: [] });
            RED.nodes.import(existing);

            const imported = subflowDef("imported").concat(importedFlow());
            imported.push({ id: "i1", type: "subflow:sf1", z: "t1", x: 100, y: 300, wires: [] });
            const result = RED.nodes.import(imported, { importMap: replaceMap(imported) });
            RED.nodes.subflow("sf1").should.have.property("name", "imported");
            RED.nodes.subflow("sf1").instances.map(function(n) { return n.id; }).sort().should.eql(["i1", "i2"]);
            RED.nodes.node("i1")._def.should.equal(RED.nodes.getType("subflow:sf1"));

            RED.nodes.import(result.removedNodes, { importMap: replaceMap(result.removedNodes) });
            RED.nodes.subflow("sf1").should.have.property("name", "local");
            RED.nodes.subflow("sf1").instances.map(function(n) { return n.id; }).sort().should.eql(["i1", "i2"]);
            idsOn("t1").should.eql(["c1", "g1", "i1", "j1", "li1", "n1", "n2"]);
        });

        function importMapFor(nodes, map) {
            const importMap = {};
            nodes.forEach(function(n) {
                const v = map[n.id] || map[n.z];
                if (v) { importMap[n.id] = v; }
            });
            return importMap;
        }

        it("replaces a flow that uses a new subflow from the same import", function() {
            RED.nodes.import(existingFlows());
            const imported = [
                { id: "sfN", type: "subflow", name: "New subflow", info: "", in: [{ x: 50, y: 30, wires: [{ id: "sfNn1" }] }], out: [], env: [] },
                { id: "sfNn1", type: "test-node", z: "sfN", name: "in subflow", x: 100, y: 50, wires: [[]] }
            ].concat(importedFlow());
            imported.push({ id: "i9", type: "subflow:sfN", z: "t1", x: 100, y: 350, wires: [] });
            RED.nodes.import(imported, { importMap: importMapFor(imported, { t1: "replace" }) });

            const instance = RED.nodes.node("i9");
            should.exist(instance);
            instance.should.have.properties({ type: "subflow:sfN", z: "t1", inputs: 1 });
            instance._def.should.equal(RED.nodes.getType("subflow:sfN"));
            RED.nodes.subflow("sfN").instances.map(function(n) { return n.id; }).should.eql(["i9"]);
            idsOn("t1").should.eql(["i9", "li1", "n1", "n3"]);
        });

        it("replaces a flow that uses a new config node from the same import", function() {
            RED.nodes.import(existingFlows());
            const imported = [{ id: "c9", type: "test-config", name: "new config" }].concat(importedFlow());
            imported[2].cfg = "c9";
            RED.nodes.import(imported, { importMap: importMapFor(imported, { t1: "replace" }) });

            RED.nodes.node("n1").should.have.property("cfg", "c9");
            RED.nodes.node("c9").users.map(function(n) { return n.id; }).should.eql(["n1"]);
        });

        it("points a replaced flow at the copy of a config node / subflow chosen as copy", function() {
            const existing = existingFlows();
            existing.push({ id: "cg", type: "test-config", name: "global config" });
            existing.push({ id: "sf1", type: "subflow", name: "Subflow", info: "", in: [{ x: 50, y: 30, wires: [] }], out: [], env: [] });
            existing.push({ id: "sfn1", type: "test-node", z: "sf1", name: "local", x: 100, y: 50, wires: [[]] });
            existing.push({ id: "m3", type: "test-node", z: "t2", name: "uses global", cfg: "cg", x: 300, y: 250, wires: [[]] });
            RED.nodes.import(existing);

            const imported = [
                { id: "cg", type: "test-config", name: "imported global config" },
                { id: "sf1", type: "subflow", name: "Imported subflow", info: "", in: [], out: [{ x: 50, y: 30, wires: [] }], env: [] },
                { id: "sfn1", type: "test-node", z: "sf1", name: "imported", x: 100, y: 50, wires: [[]] }
            ].concat(importedFlow());
            imported[4].cfg = "cg";
            imported.push({ id: "i9", type: "subflow:sf1", z: "t1", x: 100, y: 350, wires: [] });
            RED.nodes.import(imported, { importMap: importMapFor(imported, { cg: "copy", sf1: "copy", t1: "replace" }) });

            // The config node copy is used by the replaced flow
            const n1 = RED.nodes.node("n1");
            n1.cfg.should.not.equal("cg");
            const copy = RED.nodes.node(n1.cfg);
            should.exist(copy);
            copy.should.have.properties({ type: "test-config", name: "imported global config" });
            copy.users.map(function(n) { return n.id; }).should.eql(["n1"]);
            RED.nodes.node("cg").should.have.property("name", "global config");
            RED.nodes.node("cg").users.map(function(n) { return n.id; }).should.eql(["m3"]);

            // The instance uses the subflow copy
            const instance = RED.nodes.node("i9");
            instance.type.should.not.equal("subflow:sf1");
            const sfCopy = RED.nodes.subflow(instance.type.substring(8));
            should.exist(sfCopy);
            sfCopy.should.have.property("name", "Imported subflow");
            sfCopy.instances.map(function(n) { return n.id; }).should.eql(["i9"]);
            instance.should.have.properties({ inputs: 0, outputs: 1 });
            RED.nodes.subflow("sf1").should.have.property("name", "Subflow");
            RED.nodes.subflow("sf1").instances.should.have.length(0);
        });

        it("remaps only references when an imported id is used in another flow", function() {
            RED.nodes.import(existingFlows());
            const imported = importedFlow();
            imported.push({ id: "m2", type: "test-node", z: "t1", name: "m2", x: 300, y: 250, wires: [["n1"]] });
            imported[2].name = "n3";
            RED.nodes.import(imported, { importMap: replaceMap(imported) });
            const clash = RED.nodes.filterNodes({ z: "t1" }).filter(function(n) { return n.id !== "n1" && n.id !== "n3" && n.id !== "li1"; })[0];
            clash.id.should.not.equal("m2");
            // A name equal to a remapped id is not a reference
            clash.should.have.property("name", "m2");
        });

        it("undo of a flow replace restores changed flags", function() {
            RED.nodes.import(existingFlows());
            RED.nodes.node("n2").changed = true;
            RED.nodes.node("n2").moved = true;
            should.not.exist(RED.nodes.workspace("t1").changed);

            const imported = importedFlow();
            const result = RED.nodes.import(imported, { importMap: replaceMap(imported), markChanged: true });
            RED.nodes.workspace("t1").should.have.property("changed", true);
            RED.nodes.node("n1").should.have.property("changed", true);

            // History undo: RED.nodes.import(config, { importMap }) without markChanged
            const undo = RED.nodes.import(result.removedNodes, { importMap: replaceMap(result.removedNodes) });
            RED.nodes.workspace("t1").changed.should.be.false();
            RED.nodes.node("n1").changed.should.be.false();
            RED.nodes.node("n2").should.have.properties({ changed: true, moved: true });
            RED.nodes.junction("j1").changed.should.be.false();

            // Redo restores the flags of the replaced flow
            RED.nodes.import(undo.removedNodes, { importMap: replaceMap(undo.removedNodes) });
            RED.nodes.workspace("t1").should.have.property("changed", true);
            RED.nodes.node("n1").should.have.property("changed", true);
            RED.nodes.node("n3").should.have.property("changed", true);
        });

        it("restores the flow when the import fails", function() {
            RED.nodes.import(existingFlows());
            RED.editor.validateNode = function(node) {
                if (node.name === "imported 3") { throw new Error("validation failed"); }
            };
            const imported = importedFlow();
            (function() {
                RED.nodes.import(imported, { importMap: replaceMap(imported), markChanged: true });
            }).should.throw("validation failed");

            const flow = RED.nodes.workspace("t1");
            flow.should.have.properties({ label: "Local", info: "local info", disabled: false, layout: "LR", wireStyle: "orthogonal" });
            idsOn("t1").should.eql(["c1", "g1", "j1", "li1", "n1", "n2"]);
            RED.nodes.node("n1").should.have.properties({ name: "local 1", g: "g1", cfg: "c1" });
            wiresOf("n1").should.eql(["j1"]);
            RED.nodes.node("c1").users.map(function(n) { return n.id; }).should.eql(["n1"]);
        });

        it("still imports a flow with the same id as a copy", function() {
            RED.nodes.import(existingFlows());
            const imported = importedFlow();
            const importMap = {};
            imported.forEach(function(n) { importMap[n.id] = "copy"; });
            const result = RED.nodes.import(imported, { importMap: importMap });
            result.workspaces.should.have.length(1);
            result.workspaces[0].id.should.not.equal("t1");
            RED.nodes.workspace("t1").should.have.property("label", "Local");
            idsOn("t1").should.eql(["c1", "g1", "j1", "li1", "n1", "n2"]);
            RED.nodes.filterNodes({ z: result.workspaces[0].id }).should.have.length(3);
        });
    });
});
