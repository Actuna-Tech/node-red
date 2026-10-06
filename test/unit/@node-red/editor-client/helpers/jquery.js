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
 *   #37: a jQuery stand-in that records what is given to the places that parse HTML ($(string), .html(),
 *   .append(string), ...) and to the places that set text, so a test can see where a text of the
 *   remote catalog, a repository or a user goes
 *   #63: .replaceWith(s), .wrap(s), .wrapAll(s), .wrapInner(s), $.parseHTML(s) and the `html` property of
 *   $("<x>", {html: s}) are recorded too
 * This notice is required by section 4(b) of the Apache License 2.0.
 */

/**
 * jQuery stand-in for the unit tests of the editor: every element is chainable, `on` keeps the
 * handlers (a test clicks by calling them), `hasClass` knows the classes that were added.
 *
 * What is recorded (all of it is plain data for the assertions):
 * - `htmlSinks`: the strings that jQuery parses as HTML - `$("<...>")`, `$("<...>", {html: s})`, `.html(s)`,
 *   `.append(s)`, `.prepend(s)`, `.before(s)`, `.after(s)`, `.replaceWith(s)`, `.wrap(s)`, `.wrapAll(s)`,
 *   `.wrapInner(s)`, `$.parseHTML(s)`; an element given instead of a string is not recorded,
 *   `.appendTo/.prependTo` are not (they take elements);
 * - `texts`: the values set as text - `.text(v)` and the `text` property of `$("<option>", {...})`;
 * - `editableLists`: the options of every `.editableList(options)` (a test calls `addItem`);
 * - `requests`: the `$.ajax` requests, answered by the test.
 */
function createJQuery() {
    const record = { htmlSinks: [], texts: [], editableLists: [], requests: [], elements: [], getJSON: [] };

    function makeElement(source, props) {
        const state = { source, classes: new Set(), handlers: {}, attrs: {}, texts: [], htmlSinks: [] };
        const api = {
            state,
            on(event, fn) {
                (state.handlers[event] = state.handlers[event] || []).push(fn);
                return proxy;
            },
            click() {
                (state.handlers.click || []).forEach(fn => fn.call(proxy, { preventDefault() {}, stopPropagation() {} }));
                return proxy;
            },
            hasClass(name) { return state.classes.has(name); },
            addClass(names) { String(names).split(" ").forEach(n => state.classes.add(n)); return proxy; },
            removeClass(names) { String(names).split(" ").forEach(n => state.classes.delete(n)); return proxy; },
            toggleClass(name, on) {
                if (on === undefined ? !state.classes.has(name) : on) { state.classes.add(name); } else { state.classes.delete(name); }
                return proxy;
            },
            text(value) {
                if (value === undefined) { return state.texts[state.texts.length - 1]; }
                state.texts.push(String(value));
                record.texts.push(String(value));
                return proxy;
            },
            attr(name, value) {
                if (name && typeof name === "object") { Object.assign(state.attrs, name); return proxy; }
                if (value === undefined) { return state.attrs[name]; }
                state.attrs[name] = value;
                return proxy;
            },
            html(value) {
                if (value === undefined) { return ""; }
                sink(".html()", value);
                return proxy;
            },
            append(...args) { args.forEach(a => typeof a === "string" && sink(".append()", a)); return proxy; },
            prepend(...args) { args.forEach(a => typeof a === "string" && sink(".prepend()", a)); return proxy; },
            before(...args) { args.forEach(a => typeof a === "string" && sink(".before()", a)); return proxy; },
            after(...args) { args.forEach(a => typeof a === "string" && sink(".after()", a)); return proxy; },
            replaceWith(...args) { args.forEach(a => typeof a === "string" && sink(".replaceWith()", a)); return proxy; },
            wrap(...args) { args.forEach(a => typeof a === "string" && sink(".wrap()", a)); return proxy; },
            wrapAll(...args) { args.forEach(a => typeof a === "string" && sink(".wrapAll()", a)); return proxy; },
            wrapInner(...args) { args.forEach(a => typeof a === "string" && sink(".wrapInner()", a)); return proxy; },
            editableList(options) {
                if (typeof options === "object") { record.editableLists.push(options); }
                return proxy;
            },
            find() { return makeElement("find"); },
            val() { return "val"; },
            length: 1
        };
        function sink(name, value) {
            const entry = { sink: name, html: String(value) };
            state.htmlSinks.push(entry);
            record.htmlSinks.push(entry);
        }
        const proxy = new Proxy(api, {
            get(target, prop) {
                if (prop in target) { return target[prop]; }
                if (typeof prop === "symbol" || prop === "then") { return undefined; }
                return function() { return proxy; };
            }
        });
        if (typeof source === "string" && /^\s*</.test(source)) {
            sink("$()", source);
        }
        if (props && typeof props === "object") {
            Object.keys(props).forEach(function(key) {
                if (key === "text") { proxy.text(props[key]); }
                else if (key === "html") {
                    if (typeof props[key] === "string") { sink("$(html:)", props[key]); }
                    state.attrs[key] = props[key];
                }
                else if (key === "class") { String(props[key]).split(" ").forEach(n => state.classes.add(n)); }
                else { state.attrs[key] = props[key]; }
            });
        }
        record.elements.push(proxy);
        return proxy;
    }

    function jq(source, props) { return makeElement(source, props); }

    // $.parseHTML(s) parses the string as HTML
    jq.parseHTML = function(value) {
        if (typeof value === "string") {
            const entry = { sink: "$.parseHTML()", html: value };
            record.htmlSinks.push(entry);
        }
        return [];
    };

    jq.ajax = function(options) {
        const callbacks = {};
        const request = {
            options,
            done(fn) { callbacks.done = fn; return request; },
            fail(fn) { callbacks.fail = fn; return request; },
            always(fn) { callbacks.always = fn; return request; },
            // the server answers with an error response
            failWith(xhr) {
                callbacks.fail(xhr, "error", "err");
                if (callbacks.always) { callbacks.always(); }
            },
            // the server answers
            succeed(data) {
                if (callbacks.done) { callbacks.done(data, "success", {}); }
                if (callbacks.always) { callbacks.always(); }
            }
        };
        record.requests.push(request);
        return request;
    };

    // $.getJSON(url, data, callback) answers at once with the document of `jq.documents[url]`
    jq.documents = {};
    jq.getJSON = function(url, data, callback) {
        record.getJSON.push(url);
        let failure;
        if (Object.prototype.hasOwnProperty.call(jq.documents, url)) {
            callback(jq.documents[url]);
        }
        const chain = {
            fail(fn) { failure = fn; return chain; },
            always(fn) { fn(); return chain; }
        };
        return chain;
    };

    jq.record = record;
    return jq;
}

module.exports = { createJQuery };
