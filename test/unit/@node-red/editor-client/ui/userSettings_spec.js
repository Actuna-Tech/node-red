/*
 * Modified by Actuna Sp. z o.o.:
 *   FL-B-012: tests for the initialisation of the flow layout settings
 * This notice is required by section 4(b) of the Apache License 2.0.
 */
const should = require("should");
const sinon = require("sinon");

const NR_TEST_UTILS = require("nr-test-utils");

const userSettingsModulePath = NR_TEST_UTILS.resolve("@node-red/editor-client/src/js/ui/userSettings.js");

/**
 * Minimal chainable jQuery stand-in. Every element created from an HTML
 * string is recorded with the arguments of its `prop` calls, so tests can
 * check the state of the inputs built by the settings pane. Selectors
 * (`#id`) return the wrapper registered in `values` for reading back.
 */
function createJQueryMock() {
    const elements = [];
    const values = {};
    function wrap(record) {
        const target = function() {};
        const proxy = new Proxy(target, {
            get: function(t, prop) {
                if (prop === "then") {
                    return undefined;
                }
                if (prop === Symbol.toPrimitive) {
                    return function() { return ""; };
                }
                if (prop === "prop") {
                    return function(name, value) {
                        if (arguments.length === 1) {
                            return record.props[name];
                        }
                        record.props[name] = value;
                        return proxy;
                    };
                }
                if (prop === "val") {
                    return function(value) {
                        if (arguments.length === 0) {
                            return record.props.value;
                        }
                        record.props.value = value;
                        return proxy;
                    };
                }
                return function() { return proxy; };
            }
        });
        return proxy;
    }
    const $ = function(selector) {
        if (typeof selector === "string" && selector[0] === "#") {
            const record = values[selector.substring(1)] || { html: selector, props: {} };
            return wrap(record);
        }
        const record = { html: typeof selector === "string" ? selector : "[object]", props: {} };
        elements.push(record);
        const id = /id="([^"]+)"/.exec(record.html);
        if (id) {
            values[id[1]] = record;
        }
        return wrap(record);
    };
    return { $, elements, values };
}

describe("editor-client/ui/userSettings", function() {
    let jq;
    let mockRED;
    let actions;
    let panes;
    let runtimeSettings;
    let storedSettings;
    let flowLayoutEnabled;

    function load() {
        jq = createJQueryMock();
        global.$ = jq.$;
        global.localStorage = {
            store: {},
            getItem: function(k) { return this.store.hasOwnProperty(k) ? this.store[k] : null; },
            setItem: function(k, v) { this.store[k] = String(v); },
            removeItem: function(k) { delete this.store[k]; }
        };
        global.document = { documentElement: { classList: { toggle: sinon.stub() } } };
        global.window = {};
        global.window.parent = global.window;
        actions = {};
        panes = [];
        runtimeSettings = {};
        storedSettings = { editor: { view: {} } };
        mockRED = {
            _: function(key) { return key; },
            settings: Object.assign(runtimeSettings, {
                editorTheme: {},
                theme: function() { return undefined; },
                get: sinon.spy(function(key) {
                    return storedSettings.hasOwnProperty(key) ? storedSettings[key] : runtimeSettings[key];
                }),
                set: sinon.spy(function(key, value) { storedSettings[key] = value; }),
                remove: sinon.stub(),
                removeLocal: sinon.stub()
            }),
            viewLayout: { isEnabled: function() { return flowLayoutEnabled; } },
            view: {
                gridSize: sinon.stub(),
                redraw: sinon.stub(),
                layout: {
                    layoutOptions: function() { return [{ val: "LR", text: "LR" }, { val: "TB", text: "TB" }]; },
                    wireStyleOptions: function() { return [{ val: "curved", text: "curved" }]; }
                }
            },
            actions: {
                add: function(name, fn) { actions[name] = fn; },
                get: function(name) { return actions[name]; }
            },
            editor: {},
            user: { hasPermission: function() { return true; } },
            tray: { show: sinon.stub(), close: sinon.stub() },
            notify: sinon.stub()
        };
        global.RED = mockRED;
        delete require.cache[userSettingsModulePath];
        require(userSettingsModulePath);
        // Capture the panes added by init
        const add = RED.userSettings.add;
        RED.userSettings.add = function(pane) { panes.push(pane); return add(pane); };
    }

    afterEach(function() {
        sinon.restore();
        delete global.RED;
        delete global.$;
        delete global.localStorage;
        delete global.document;
        delete global.window;
        delete require.cache[userSettingsModulePath];
    });

    describe("flow layout settings (FL-B-012)", function() {
        it("does not redraw the view on init when the flow layout functions are enabled", function() {
            flowLayoutEnabled = true;
            load();
            RED.userSettings.init();
            RED.view.redraw.called.should.be.false();
            // The defaults are still stored
            storedSettings.editor.view["view-flow-layout"].should.equal("LR");
            storedSettings.editor.view["view-wire-style"].should.equal("curved");
        });

        it("redraws the view when the user changes the layout in the settings", function() {
            flowLayoutEnabled = true;
            load();
            RED.userSettings.init();
            RED.view.redraw.resetHistory();
            RED.userSettings.toggle("view-flow-layout");
            RED.view.redraw.calledWith(true).should.be.true();
        });

        it("still calls the init callbacks of the other settings", function() {
            flowLayoutEnabled = true;
            load();
            RED.userSettings.init();
            RED.view.gridSize.calledWith(20).should.be.true();
        });

        it("does not add the flow layout settings when disabled", function() {
            flowLayoutEnabled = false;
            load();
            RED.userSettings.init();
            RED.view.redraw.called.should.be.false();
            should.not.exist(storedSettings.editor.view["view-flow-layout"]);
        });
    });
});
