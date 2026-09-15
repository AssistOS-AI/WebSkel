import assert from "node:assert/strict";
import { setImmediate } from "node:timers/promises";
import { beforeEach, test } from "node:test";
import WebSkel from "../webSkel.js";

class ElementStub {
    constructor() {
        this.attributes = [];
        this.children = [];
        this.innerHTML = "";
        const classes = new Set();
        this.classList = {
            add: (...names) => names.forEach(name => classes.add(name)),
            remove: name => classes.delete(name),
            contains: name => classes.has(name),
            values: () => classes.values()
        };
    }

    setAttribute(name, value) {
        this.attributes = this.attributes.filter(attribute => attribute.name !== name);
        this.attributes.push({ name, nodeName: name, nodeValue: value });
    }

    getAttribute(name) {
        return this.attributes.find(attribute => attribute.name === name)?.nodeValue;
    }

    cloneNode() {
        const clone = new ElementStub();
        clone.classList.add(...this.classList.values());
        clone.innerHTML = this.innerHTML;
        return clone;
    }

    appendChild(child) {
        this.children.push(child);
        child.parentElement = this;
        return child;
    }

    remove() {
        this.parentElement.children = this.parentElement.children.filter(child => child !== this);
    }

    showModal() {
        this.open = true;
    }

    close() {
        this.open = false;
    }

    querySelectorAll(selector) {
        const descendants = this.children.flatMap(child => [child, ...child.querySelectorAll("*")]);
        return descendants.filter(child => {
            if (selector === "*") return true;
            if (selector === ".spinner") return child.classList.contains("spinner");
            if (selector === "[data-presenter]") return child.getAttribute("data-presenter") !== undefined;
            if (selector.startsWith("[data-id")) return child.getAttribute("data-id") === selector.split("'")[1];
            return child.componentName === selector;
        });
    }

    querySelector(selector) {
        return this.querySelectorAll(selector)[0] || null;
    }

    addEventListener() {}
}

let app;
let errors;
let history;

beforeEach(context => {
    const body = new ElementStub();
    const definitions = new Map();
    const globals = {
        document: {
            body,
            createElement: () => new ElementStub(),
            addEventListener() {},
            querySelector: selector => body.querySelector(selector),
            querySelectorAll: selector => body.querySelectorAll(selector)
        },
        window: {
            location: { hash: "", protocol: "http:", host: "example.test" },
            history: { pushState: (...args) => history.push(args) }
        },
        HTMLElement: ElementStub,
        customElements: {
            get: name => definitions.get(name),
            define: (name, definition) => definitions.set(name, definition)
        }
    };
    for (const [name, value] of Object.entries(globals)) {
        const previous = Object.getOwnPropertyDescriptor(globalThis, name);
        Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
        context.after(() => {
            if (previous) Object.defineProperty(globalThis, name, previous);
            else delete globalThis[name];
        });
    }
    context.mock.method(console, "log", () => {});
    context.mock.method(console, "error", () => {});
    app = new WebSkel();
    WebSkel.instance = app;
    context.after(() => { delete WebSkel.instance; });
    app.configs = { components: [{ name: "example-page" }] };
    app.setDomElementForPages(new ElementStub());
    errors = [];
    history = [];
    window.showApplicationError = async (...args) => { errors.push(args); };
});

function deferred() {
    return Promise.withResolvers();
}

async function assertPending(promise) {
    let settled = false;
    promise.then(() => { settled = true; }, () => { settled = true; });
    await setImmediate();
    assert.equal(settled, false);
}

function addPageChild(name, promise) {
    const child = new ElementStub();
    child.componentName = name;
    child.setAttribute("data-presenter", name);
    child.renderCompletePromise = promise;
    app._appContent.appendChild(child);
    return child;
}

async function createComponent(presenterClass) {
    const component = { name: "example-component" };
    app.ResourceManager.loadComponent = async () => ({ html: "<span>ready</span>", css: [] });
    app.ResourceManager.components[component.name] = { presenter: presenterClass };
    await app.defineComponent(component);
    const Element = customElements.get(component.name);
    const element = new Element();
    if (presenterClass) element.setAttribute("data-presenter", component.name);
    await element.connectedCallback();
    return element;
}

test("nested loading shares one modal and closes only after the final release", () => {
    const first = app.showLoading();
    const second = app.showLoading();
    assert.equal(first, second);
    assert.equal(app.loaderCount, 2);
    assert.equal(document.body.children.length, 1);
    const loader = document.body.children[0];
    assert.equal(loader.open, true);
    assert.equal(loader.getAttribute("data-id"), first);
    app.hideLoading(second);
    assert.equal(app.loaderCount, 1);
    assert.equal(loader.open, true);
    app.hideLoading("stale-request-id");
    assert.equal(loader.open, false);
    assert.equal(document.body.children.length, 0);
    assert.equal(app.loaderCount, 0);
    assert.equal(app.activeLoaderId, null);
    assert.notEqual(app.showLoading(), first);
});

test("clearLoading and missing modal recovery reset loading state", () => {
    app.showLoading();
    app.showLoading();
    app.clearLoading();
    assert.equal(document.body.children.length, 0);
    assert.equal(app.loaderCount, 0);
    assert.equal(app.activeLoaderId, null);
    app.showLoading();
    document.body.children[0].remove();
    const orphan = app.defaultLoader.cloneNode();
    document.body.appendChild(orphan);
    app.hideLoading();
    assert.equal(document.body.children.length, 0);
    assert.equal(app.loaderCount, 0);
    assert.equal(app.activeLoaderId, null);
    document.body.appendChild(app.defaultLoader.cloneNode());
    app.hideLoading();
    assert.equal(document.body.children.length, 0);
});

test("dynamic navigation keeps its loader active until the page render completes", { timeout: 2000 }, async () => {
    const render = deferred();
    addPageChild("example-page", render.promise);
    const navigation = app.changeToDynamicPage("example-page", "example-page/details?tab=one", { item: "42" });
    await assertPending(navigation);
    assert.equal(app.loaderCount, 1);
    assert.match(app._appContent.innerHTML, /data-item="42"/);
    assert.equal(history[0][2], "#example-page/details?tab=one");
    render.resolve();
    await navigation;
    assert.equal(app.loaderCount, 0);
});

test("static navigation waits for every presenter render", { timeout: 2000 }, async () => {
    const first = deferred();
    const second = deferred();
    addPageChild("first-page", first.promise);
    addPageChild("second-page", second.promise);
    app.fetchTextResult = async (url, skipHistory) => {
        assert.equal(url, "/page.html");
        assert.equal(skipHistory, true);
        return "<first-page></first-page><second-page></second-page>";
    };
    const navigation = app.changeToStaticPage("/page.html", true);
    await assertPending(navigation);
    first.resolve();
    await assertPending(navigation);
    assert.equal(app.loaderCount, 1);
    second.resolve();
    await navigation;
    assert.equal(app.loaderCount, 0);
});

test("navigation reports rendering and fetch failures and releases its loader", async () => {
    app.updateAppContent = async () => { throw new Error("dynamic render failed"); };
    await app.changeToDynamicPage("example-page", "example-page");
    assert.equal(errors[0][1], "dynamic render failed");
    assert.equal(app.loaderCount, 0);
    app.fetchTextResult = async () => { throw new Error("static fetch failed"); };
    await app.changeToStaticPage("/page.html");
    assert.equal(errors[1][1], "static fetch failed");
    assert.equal(app.loaderCount, 0);
});

test("history safely ignores popstate before the app content is mounted", async () => {
    app._appContent = {};
    delete app.configs;
    window.location.hash = "#example-page";
    await window.onpopstate({ state: { relativeUrlContent: "stale content" } });
    assert.deepEqual(app._appContent, {});
});

test("history navigates from a known hash without pushing history and preserves active presenters", async () => {
    window.location.hash = "#example-page/details?tab=two";
    const calls = [];
    app.changeToDynamicPage = async (...args) => { calls.push(args); };
    await window.onpopstate({ state: { relativeUrlContent: "stale content" } });
    assert.deepEqual(calls, [["example-page", "example-page/details?tab=two", null, true]]);
    const child = addPageChild("example-page", Promise.resolve());
    child.webSkelPresenter = {};
    await window.onpopstate({ state: null });
    assert.equal(calls.length, 1);
    assert.equal(history.length, 0);
});

test("history content restoration waits for presenter renders", { timeout: 2000 }, async () => {
    const render = deferred();
    addPageChild("example-page", render.promise);
    window.location.hash = "#unknown-page";
    const navigation = window.onpopstate({ state: { relativeUrlContent: "saved page" } });
    await assertPending(navigation);
    assert.equal(app._appContent.innerHTML, "saved page");
    render.resolve();
    await navigation;
});

test("descendant render waits exclude the parent and tolerate child rejections", { timeout: 2000 }, async () => {
    const child = deferred();
    const parent = { renderCompletePromise: new Promise(() => {}) };
    parent.querySelectorAll = () => [parent, { renderCompletePromise: child.promise }, {}, { renderCompletePromise: 1 }];
    const waiting = app.ResourceManager.waitForDescendantRenders(parent);
    await assertPending(waiting);
    child.reject(new Error("child render failed"));
    await waiting;
});

test("presenter afterRender runs after descendant renders and completes its own render", { timeout: 2000 }, async () => {
    const events = [];
    const childRender = deferred();
    const component = await createComponent(class {
        async beforeRender() { events.push("before"); }
        async afterRender() { events.push("after"); }
    });
    component.refresh = () => {
        events.push("refresh");
        const child = new ElementStub();
        child.setAttribute("data-presenter", "child-component");
        child.renderCompletePromise = childRender.promise;
        component.appendChild(child);
    };
    const initialCompletion = component.renderCompletePromise;
    const rendering = component.invalidateFn();
    await initialCompletion;
    assert.notEqual(component.renderCompletePromise, initialCompletion);
    await assertPending(component.renderCompletePromise);
    assert.deepEqual(events, ["before", "refresh"]);
    assert.equal(app.loaderCount, 1);
    childRender.resolve();
    await rendering;
    await component.renderCompletePromise;
    assert.deepEqual(events, ["before", "refresh", "after"]);
    assert.equal(app.loaderCount, 0);
});

test("component rendering and data-loading errors settle completion without consuming another loader", { timeout: 2000 }, async () => {
    const component = await createComponent(class {
        async beforeRender() { throw "plain render failure"; }
    });
    const outerLoading = app.showLoading();
    await component.invalidateFn();
    await component.renderCompletePromise;
    assert.match(component.innerHTML, /plain render failure/);
    assert.equal(app.loaderCount, 1);
    component.resetRenderCompletePromise();
    await component.invalidateFn(async () => { throw new Error("data load failed"); });
    await component.renderCompletePromise;
    assert.match(component.innerHTML, /data load failed/);
    assert.equal(app.loaderCount, 1);
    app.hideLoading(outerLoading);
    assert.equal(app.loaderCount, 0);
});

test("components without presenters complete their initial render", { timeout: 2000 }, async () => {
    const component = await createComponent();
    await component.renderCompletePromise;
    assert.equal(component.innerHTML, "<span>ready</span>");
    assert.equal(component.onRenderComplete, null);
});
