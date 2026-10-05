/** Small DOM host for mounting React client components in node:test. */
type Listener = (event: { type: string }) => void;

class TestNode {
  nodeType: number;
  nodeName: string;
  nodeValue: string | null = null;
  parentNode: TestNode | null = null;
  childNodes: TestNode[] = [];
  ownerDocument: TestDocument;
  listeners = new Map<string, Listener[]>();

  constructor(document: TestDocument, type: number, name: string) {
    this.ownerDocument = document;
    this.nodeType = type;
    this.nodeName = name;
  }
  get firstChild() { return this.childNodes[0] ?? null; }
  get nextSibling(): TestNode | null {
    return this.parentNode?.childNodes[this.parentNode.childNodes.indexOf(this) + 1] ?? null;
  }
  appendChild<T extends TestNode>(node: T) {
    if (node.parentNode) node.parentNode.removeChild(node);
    node.parentNode = this;
    this.childNodes.push(node);
    return node;
  }
  insertBefore<T extends TestNode>(node: T, before: TestNode | null) {
    if (!before) return this.appendChild(node);
    node.parentNode = this;
    this.childNodes.splice(this.childNodes.indexOf(before), 0, node);
    return node;
  }
  removeChild<T extends TestNode>(node: T) {
    this.childNodes.splice(this.childNodes.indexOf(node), 1);
    node.parentNode = null;
    return node;
  }
  addEventListener(type: string, listener: Listener) {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }
  removeEventListener(type: string) { this.listeners.delete(type); }
  set textContent(value: string) {
    this.childNodes = [];
    if (value) this.appendChild(this.ownerDocument.createTextNode(value));
  }
  get textContent(): string {
    return this.nodeType === 3 ? this.nodeValue ?? "" : this.childNodes.map((n) => n.textContent).join("");
  }
}

class TestElement extends TestNode {
  tagName: string;
  private attributes = new Map<string, string>();
  style = { setProperty() {}, removeProperty() {} };
  constructor(document: TestDocument, tag: string) {
    super(document, 1, tag.toUpperCase());
    this.tagName = tag.toUpperCase();
  }
  setAttribute(name: string, value: string) { this.attributes.set(name, String(value)); }
  setAttributeNS(_namespace: string | null, name: string, value: string) { this.setAttribute(name, value); }
  getAttribute(name: string) { return this.attributes.get(name) ?? null; }
  removeAttribute(name: string) { this.attributes.delete(name); }
  removeAttributeNS(_namespace: string | null, name: string) { this.removeAttribute(name); }
  get className() { return this.getAttribute("class") ?? ""; }
  set className(value: string) { this.setAttribute("class", value); }
  get id() { return this.getAttribute("id") ?? ""; }
  getBoundingClientRect() { return { x: 0, y: 0, top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 }; }
  focus() {}
  blur() {}
}

class TestDocument extends TestNode {
  defaultView: Record<string, unknown>;
  activeElement: TestElement | null = null;
  documentElement: TestElement;
  constructor() {
    super(null as unknown as TestDocument, 9, "#document");
    this.ownerDocument = this;
    this.documentElement = new TestElement(this, "html");
    this.defaultView = {};
  }
  createElement(tag: string) { return new TestElement(this, tag); }
  createElementNS(_namespace: string | null, tag: string) { return this.createElement(tag); }
  createTextNode(value: string) {
    const node = new TestNode(this, 3, "#text");
    node.nodeValue = value;
    return node;
  }
  createComment(value: string) {
    const node = new TestNode(this, 8, "#comment");
    node.nodeValue = value;
    return node;
  }
  getElementById() { return null; }
}

export function installFakeDom() {
  const document = new TestDocument();
  const window = {
    document,
    HTMLIFrameElement: class HTMLIFrameElement {},
    getComputedStyle: () => ({ getPropertyValue: () => "" }),
    addEventListener() {},
    removeEventListener() {},
  };
  document.defaultView = window;
  Object.assign(globalThis, { document, window, Element: TestElement, HTMLElement: TestElement, SVGElement: TestElement, Node: TestNode, HTMLIFrameElement: window.HTMLIFrameElement });
  return { document, window };
}
