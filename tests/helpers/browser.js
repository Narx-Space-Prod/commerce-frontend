import vm from "node:vm";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const filename = fileURLToPath(new URL("../../public/app.js", import.meta.url));
const source = await readFile(filename, "utf8");

class Element {
  constructor(tag = "div") {
    this.tagName = tag;
    this.children = [];
    this.attributes = {};
    this.dataset = {};
    this.value = "";
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.open = false;
    this.elements = new Proxy(
      {},
      { get: (fields, name) => (fields[name] ??= new Element("input")) },
    );
  }
  set textContent(value) {
    this.text = String(value);
    this.children = [];
  }
  get textContent() {
    return (this.text || "") + this.children.map((node) => node.textContent ?? node).join("");
  }
  append(...nodes) {
    this.children.push(...nodes);
    this.onappend?.(...nodes);
  }
  replaceChildren(...nodes) {
    this.text = "";
    this.children = [...nodes];
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
  }
  reset() {
    for (const field of Object.values(this.elements)) field.value = "";
  }
  showModal() {
    this.open = true;
  }
  close() {
    this.open = false;
  }
}

export const product = {
  id: "mug",
  name: "Everyday mug",
  price: 12900,
  currency: "INR",
  stock: 8,
  emoji: "◈",
  description: "Stoneware",
};
export const customer = {
  id: "customer-1",
  name: "Customer",
  email: "customer@example.test",
  role: "customer",
};
export const order = {
  id: "11111111-1111-1111-1111-111111111111",
  created_at: "2026-11-01T12:00:00Z",
  total: 12900,
  currency: "INR",
  status: "confirmed",
  payment_status: "paid",
  items: [{ ...product, productId: "mug", quantity: 1 }],
  delivery: {
    name: "Customer",
    address: "1 Main Street",
    city: "Kolkata",
    postalCode: "700001",
    country: "India",
  },
};

export function browser({
  routes = {},
  pathname = "/",
  search = "",
  confirm = true,
  crypto,
  provider,
} = {}) {
  const elements = new Map(),
    stored = new Map(),
    navigation = [],
    calls = [];
  const get = (id) => {
    if (!elements.has(id)) elements.set(id, new Element());
    return elements.get(id);
  };
  const tabs = ["dashboard", "products", "orders", "audit"].map((section) => {
    const node = new Element("button");
    node.dataset.admin = section;
    return node;
  });
  const head = new Element("head");
  const context = vm.createContext({
    document: {
      getElementById: get,
      createElement: (tag) => new Element(tag),
      querySelectorAll: () => tabs,
      head,
    },
    Intl,
    URLSearchParams,
    Uint8Array,
    queueMicrotask,
    crypto: crypto || { randomUUID: () => "test-checkout-key" },
    fetch: async (path, options) => {
      calls.push({ path, ...options, body: options.body ? JSON.parse(options.body) : undefined });
      const value = routes[path];
      if (value instanceof Error) throw value;
      if (value === undefined) throw Error("Unexpected API request: " + path);
      const result = typeof value === "function" ? await value(options) : value;
      return {
        ok: !result?.errorStatus,
        status: result?.errorStatus || 200,
        json: async () => result,
      };
    },
    FormData: class {
      constructor(form) {
        this.data = form.data || {};
      }
      *[Symbol.iterator]() {
        yield* Object.entries(this.data);
      }
    },
    sessionStorage: {
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => stored.set(key, value),
      removeItem: (key) => stored.delete(key),
    },
    location: { pathname, search, assign: (path) => navigation.push(path) },
    window: { confirm: () => confirm, ...(provider ? { Razorpay: provider } : {}) },
    confirm: () => confirm,
  });
  // Execute the complete UI source with its real filename for V8 coverage.
  // Bootstrap is invoked explicitly by each test, without external network.
  vm.runInContext(source.slice(0, source.lastIndexOf("\nstart()")), context, { filename });
  const run = (code) => vm.runInContext(code, context);
  const seed = (values) => {
    context.fixture = values;
    run(
      "({products, cart, user, paymentConfig, page, adminSection, adminPage, pending} = {products, cart, user, paymentConfig, page, adminSection, adminPage, pending, ...fixture})",
    );
  };
  seed({
    products: [product],
    cart: { items: [{ productId: "mug", quantity: 1 }] },
    paymentConfig: { enabled: true, mode: "test" },
  });
  return { get, run, seed, calls, stored, navigation, context, tabs, head };
}

export function find(root, predicate) {
  if (predicate(root)) return root;
  for (const child of root.children || []) {
    if (typeof child !== "object") continue;
    const result = find(child, predicate);
    if (result) return result;
  }
}
export function button(root, text) {
  return find(root, (node) => node.tagName === "button" && node.textContent === text);
}
export function form(root) {
  return find(root, (node) => node.tagName === "form");
}
export const submit = (target) => ({ target, preventDefault() {} });
