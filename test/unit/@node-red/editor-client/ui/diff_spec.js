/*
 * Modified by Actuna Sp. z o.o.:
 *   FL-B-004: tests for the property rows of the diff properties table
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
const should = require("should");

const NR_TEST_UTILS = require("nr-test-utils");

const diffModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/diff.js");

describe("editor-client/ui/diff", function() {
    let diff;

    beforeEach(function() {
        global.RED = {};
        delete require.cache[diffModulePath];
        require(diffModulePath);
        diff = RED.diff;
    });

    afterEach(function() {
        delete global.RED;
        delete require.cache[diffModulePath];
    });

    describe("getNodePropertyNames (FL-B-004)", function() {
        const tabDef = { defaults: { label: { value: "" }, disabled: { value: false }, info: { value: "" }, env: { value: [] } } };
        const nodeDef = { defaults: { name: { value: "" }, func: { value: "" } } };

        it("lists the properties of the base version and the type defaults", function() {
            const base = { id: "n1", type: "function", z: "t1", name: "a", func: "", x: 10, y: 20, wires: [[]], extra: 1 };
            diff.getNodePropertyNames(nodeDef, base, null, undefined)
                .should.eql(["extra", "name", "func", "inputLabels", "outputLabels"]);
        });

        it("adds a tab layout property set only in the remote version", function() {
            const base = { id: "t1", type: "tab", label: "Flow 1", disabled: false, info: "", env: [] };
            const local = Object.assign({}, base);
            const remote = Object.assign({}, base, { layout: "TB", wireStyle: "orthogonal" });
            const props = diff.getNodePropertyNames(tabDef, base, local, remote);
            props.should.containEql("layout");
            props.should.containEql("wireStyle");
            props.should.not.containEql("inputLabels");
        });

        it("adds a tab layout property set only in the local version", function() {
            const base = { id: "t1", type: "tab", label: "Flow 1", disabled: false, info: "", env: [] };
            const local = Object.assign({}, base, { layout: "auto" });
            diff.getNodePropertyNames(tabDef, base, local).should.containEql("layout");
        });

        it("adds a subflow layout property added in either version", function() {
            const base = { id: "s1", type: "subflow", name: "sf", info: "", in: [], out: [], env: [], color: "#DDAA99" };
            const remote = Object.assign({}, base, { layout: "TB" });
            const local = Object.assign({}, base, { wireStyle: "orthogonal" });
            const props = diff.getNodePropertyNames({}, base, local, remote);
            props.should.containEql("layout");
            props.should.containEql("wireStyle");
        });

        it("adds the node orientation added in either version", function() {
            const base = { id: "n1", type: "function", z: "t1", name: "a", func: "", x: 10, y: 20, wires: [[]] };
            const remote = Object.assign({}, base, { o: "LR" });
            diff.getNodePropertyNames(nodeDef, base, base, remote).should.containEql("o");
            diff.getNodePropertyNames(nodeDef, base, remote, base).should.containEql("o");
            diff.getNodePropertyNames(nodeDef, base, remote).should.containEql("o");
        });

        it("keeps a property removed in either version", function() {
            const base = { id: "n1", type: "function", z: "t1", name: "a", func: "", x: 10, y: 20, wires: [[]], o: "TB" };
            const changed = Object.assign({}, base);
            delete changed.o;
            diff.getNodePropertyNames(nodeDef, base, changed, changed).should.containEql("o");
        });

        it("lists each property once", function() {
            const base = { id: "n1", type: "function", z: "t1", name: "a", func: "", x: 10, y: 20, wires: [[]] };
            const other = Object.assign({}, base, { o: "TB", icon: "font-awesome/fa-cog" });
            const props = diff.getNodePropertyNames(nodeDef, base, other, other);
            props.filter(function(p) { return p === "o" }).should.have.length(1);
            props.filter(function(p) { return p === "icon" }).should.have.length(1);
            props[0].should.equal("icon");
        });

        it("does not list properties that have their own rows or credentials", function() {
            const base = { id: "n1", type: "function", z: "t1", name: "a", func: "", x: 10, y: 20, wires: [[]] };
            const other = Object.assign({}, base, { x: 50, w: 120, h: 40, z: "t2", credentials: { password: "secret" } });
            const props = diff.getNodePropertyNames(nodeDef, base, other, other);
            ["id", "type", "x", "y", "w", "h", "z", "wires", "credentials"].forEach(function(p) {
                props.should.not.containEql(p);
            });
        });
    });

    describe("merge of remote layout changes (FL-B-004)", function() {
        it("keeps the remote layout and orientation together with a local move", function(done) {
            const base = [
                { id: "d1", type: "tab", label: "Flow 1", disabled: false, info: "", env: [] },
                { id: "a1", type: "inject", z: "d1", x: 100, y: 100, wires: [["a3"]] },
                { id: "a3", type: "debug", z: "d1", x: 300, y: 100, wires: [] }
            ];
            const local = JSON.parse(JSON.stringify(base));
            local[1].x = 150;
            const remote = JSON.parse(JSON.stringify(base));
            remote[0].layout = "TB";
            remote[2].o = "LR";

            let imported;
            global.$ = { ajax: function(opts) { opts.success({ flows: remote, rev: "2" }) } };
            const noop = function() {};
            Object.assign(RED, {
                nodes: {
                    createCompleteNodeSet: function() { return JSON.parse(JSON.stringify(local)) },
                    originalFlow: function() { return JSON.parse(JSON.stringify(base)) },
                    workspace: noop, subflow: noop, node: noop,
                    dirty: function() { return false },
                    clear: noop,
                    import: function(config) { imported = config; return { nodes: [] } },
                    version: noop
                },
                workspaces: { active: function() { return "d1" }, refresh: noop, show: noop },
                history: { push: noop },
                view: { redraw: noop },
                palette: { refresh: noop },
                sidebar: { config: { refresh: noop } }
            });
            try {
                diff.getRemoteDiff(function(result) {
                    try {
                        Object.keys(result.conflicts).should.have.length(0);
                        result.remoteDiff.changed.should.have.properties({ d1: true, a3: true });
                        result.localDiff.changed.should.have.properties({ a1: true });
                        diff.mergeDiff(result);
                        const byId = {};
                        imported.forEach(function(n) { byId[n.id] = n });
                        byId.d1.should.have.property("layout", "TB");
                        byId.a3.should.have.property("o", "LR");
                        byId.a1.should.have.property("x", 150);
                        done();
                    } catch (err) {
                        done(err);
                    }
                });
            } finally {
                delete global.$;
            }
        });
    });
});
