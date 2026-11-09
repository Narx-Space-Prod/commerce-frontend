import test from "node:test";
import assert from "node:assert/strict";
import {
  browser,
  product,
  customer,
  order,
  button,
  form,
  find,
  submit,
} from "./helpers/browser.js";

const clone = (value) => JSON.parse(JSON.stringify(value));
const identity = {
  "/api/auth/session": { user: customer },
  "/api/cart": { items: [{ productId: "mug", quantity: 1 }] },
  "/api/products": [product],
  "/api/payments/config": { enabled: true },
};

test("catalogue and bag controls update quantities, totals and checkout identity", async () => {
  const b = browser({
    routes: {
      "/api/cart/items/mug": (options) => ({
        items:
          options.method === "DELETE"
            ? []
            : [{ productId: "mug", quantity: JSON.parse(options.body).quantity }],
      }),
    },
  });
  b.stored.set("checkout", "old");
  b.run("renderProducts(); renderCart()");
  assert.match(b.get("products").textContent, /Everyday mug/);
  await button(b.get("products"), "Add to bag").onclick();
  assert.equal(b.calls[0].body.quantity, 2);
  assert.equal(b.get("count").textContent, "2");
  assert.equal(b.stored.has("checkout"), false);
  await button(b.get("cart-items"), "−").onclick();
  assert.equal(b.get("count").textContent, "1");
  await button(b.get("cart-items"), "+").onclick();
  assert.equal(b.get("count").textContent, "2");
  await button(b.get("cart-items"), "Remove").onclick();
  assert.equal(b.calls.at(-1).method, "DELETE");
  assert.equal(b.get("checkout").disabled, true);
  assert.match(b.get("cart-items").textContent, /waiting/);
  b.get("cart-toggle").onclick();
  assert.equal(b.get("cart-panel").open, true);
  b.get("close-cart").onclick();
  assert.equal(b.get("cart-panel").open, false);
});

test("sold-out products and quantity limits disable controls; failures restore UI", async () => {
  const b = browser({ routes: { "/api/cart/items/mug": new Error("offline") } });
  b.seed({
    products: [{ ...product, stock: 0 }],
    cart: {
      items: [
        { productId: "mug", quantity: 20 },
        { productId: "gone", quantity: 1 },
      ],
    },
  });
  b.run("renderProducts(); renderCart()");
  assert.equal(button(b.get("products"), "Sold out").disabled, true);
  assert.equal(button(b.get("cart-items"), "+").disabled, true);
  await b.run("changeQuantity('mug', 1)");
  assert.equal(b.run("pending"), false);
  assert.match(b.get("status").textContent, /offline/);
  b.seed({ pending: true });
  await b.run("changeQuantity('mug', 2)");
  assert.equal(b.calls.length, 1);
});

test("API errors remain readable and preserve HTTP status", async () => {
  for (const [response, message] of [
    [{ errorStatus: 401 }, /expired/],
    [{ errorStatus: 429 }, /Too many/],
    [{ errorStatus: 400, detail: "invalid_email" }, /valid email/],
    [{ errorStatus: 500 }, /complete that request/],
  ]) {
    const b = browser({ routes: { "/api/fail": response } });
    await assert.rejects(
      b.run("api('/fail')"),
      (error) => error.status === response.errorStatus && message.test(error.message),
    );
  }
});

test("checkout keys survive retry, renew after cart changes, and work without randomUUID", () => {
  const b = browser({ crypto: { getRandomValues: (bytes) => bytes.fill(7) } });
  b.stored.set("checkout", "invalid-json");
  const key = b.run("checkoutKey()");
  assert.match(key, /^[a-f0-9-]{14}4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(b.run("checkoutKey()"), key);
  b.seed({ cart: { items: [] } });
  b.run("checkoutKey()");
  assert.equal(JSON.parse(b.stored.get("checkout")).signature, "[]");
  b.context.sessionStorage.getItem = () => {
    throw Error("blocked");
  };
  b.context.sessionStorage.setItem = () => {
    throw Error("blocked");
  };
  assert.match(b.run("checkoutKey()"), /^[a-f0-9-]{36}$/);
});

test("account tabs, authentication and logout keep credentials out of browser storage", async () => {
  const b = browser({
    search: "?next=checkout",
    routes: {
      "/api/auth/register": { user: customer },
      "/api/auth/logout": { status: "signed_out" },
    },
  });
  b.get("register-tab").onclick();
  assert.equal(b.get("auth-password").autocomplete, "new-password");
  assert.equal(b.get("auth-name").required, true);
  b.get("auth-email").value = customer.email;
  b.get("auth-password").value = "example passphrase";
  b.get("auth-name").value = customer.name;
  await b.get("auth-form").onsubmit(submit({}));
  assert.equal(b.calls[0].body.email, customer.email);
  assert.equal(b.get("auth-password").value, "");
  assert.deepEqual(b.navigation, ["/checkout"]);
  assert.equal(b.stored.size, 0);
  b.run("renderAccount()");
  assert.equal(b.get("profile-name").textContent, customer.name);
  await b.get("logout").onclick();
  assert.equal(b.navigation.at(-1), "/");
  b.get("login-tab").onclick();
  assert.equal(b.get("auth-password").minLength, 1);
});

test("failed login/logout restores buttons and displays the error", async () => {
  const b = browser({
    routes: {
      "/api/auth/login": { errorStatus: 401, error: "invalid_credentials" },
      "/api/auth/logout": new Error("offline"),
    },
  });
  await b.get("auth-form").onsubmit(submit({}));
  assert.match(b.get("auth-error").textContent, /incorrect/);
  assert.equal(b.get("auth-submit").disabled, false);
  await b.get("logout").onclick();
  assert.equal(b.get("logout").disabled, false);
  assert.match(b.get("status").textContent, /offline/);
});

test("checkout requires identity, stock and enabled payment configuration", () => {
  const b = browser();
  b.run("renderCheckout()");
  assert.equal(b.get("checkout-content").hidden, true);
  b.seed({
    user: customer,
    cart: { items: [{ productId: "gone", quantity: 1 }] },
    paymentConfig: { enabled: false },
  });
  b.run("renderCheckout()");
  assert.equal(b.get("delivery-name").value, customer.name);
  assert.equal(b.get("place-order").disabled, true);
  assert.match(b.get("checkout-summary").textContent, /not configured/);
  b.seed({ cart: { items: [] }, paymentConfig: { enabled: true, mode: "fixture" } });
  b.run("renderCheckout()");
  assert.match(b.get("checkout-summary").textContent, /Local payment simulator/);
  assert.match(b.get("checkout-summary").textContent, /bag is empty/);
});

test("orders pagination, empty states and errors remain usable", async () => {
  const b = browser({
    routes: {
      "/api/orders?page=0": { orders: [order], hasMore: true },
      "/api/orders?page=1": { orders: [], hasMore: false },
    },
  });
  await b.run("renderOrders()");
  assert.match(b.get("order-list").textContent, /Everyday mug/);
  assert.equal(b.get("previous-orders").disabled, true);
  assert.equal(b.get("next-orders").disabled, false);
  await b.get("next-orders").onclick();
  assert.match(b.get("order-list").textContent, /story starts here/);
  await b.get("previous-orders").onclick();
  assert.equal(b.get("page-number").textContent, "Page 1");
  b.seed({ user: customer });
  await b.run("renderOrders()");
  assert.match(b.get("orders-intro").textContent, /saved to your account/);
  const failed = browser({ routes: { "/api/orders?page=0": new Error("offline") } });
  await failed.run("renderOrders()");
  assert.match(failed.get("order-list").textContent, /offline/);
});

test("order receipt displays payment state and delivery; missing orders do not leak details", async () => {
  const b = browser({ search: "?confirmed=1", routes: { ["/api/orders/" + order.id]: order } });
  await b.run(`renderOrder('${order.id}')`);
  assert.match(b.get("order-detail").textContent, /It’s yours/);
  assert.match(b.get("order-detail").textContent, /Kolkata/);
  const missing = browser({ routes: { "/api/orders/missing": { errorStatus: 404 } } });
  await missing.run("renderOrder('missing')");
  assert.match(missing.get("order-detail").textContent, /Order not found/);
  const failed = browser({ routes: { "/api/orders/missing": new Error("offline") } });
  await failed.run("renderOrder('missing')");
  assert.match(failed.get("order-detail").textContent, /Unable to load/);
  for (const [status, expected] of [
    ["processing", "Preparing"],
    ["shipped", "Shipped"],
    ["delivered", "Delivered"],
    ["refunded", "Refunded"],
    ["cancelled", "Cancelled"],
    ["other", "other"],
  ])
    assert.match(b.run(`statusText({status:'${status}'})`), new RegExp(expected));
  assert.equal(b.run("statusText({payment_status:'refunding'})"), "Refund pending");
});

test("each page bootstrap establishes session before dependent requests and renders its route", async () => {
  for (const pathname of [
    "/",
    "/account",
    "/checkout",
    "/orders",
    "/admin",
    "/orders/" + order.id,
  ]) {
    const b = browser({
      pathname,
      routes: {
        ...identity,
        "/api/orders?page=0": { orders: [], hasMore: false },
        ["/api/orders/" + order.id]: order,
      },
    });
    await b.run("start()");
    assert.equal(b.calls[0].path, "/api/cart");
    assert.equal(b.calls[1].path, "/api/auth/session");
    assert.equal(b.get("profile-name").textContent, customer.name);
  }
  const failed = browser({
    routes: {
      ...identity,
      "/api/cart": new Error("offline"),
      "/api/products": new Error("catalogue down"),
      "/api/payments/config": new Error("disabled"),
    },
  });
  await failed.run("start()");
  assert.match(failed.get("status").textContent, /catalogue down/);
  const noIdentity = browser({
    routes: { "/api/cart": { items: [] }, "/api/auth/session": new Error("offline") },
  });
  await noIdentity.run("start()");
  assert.match(noIdentity.get("status").textContent, /offline/);
});

test("administration rejects customers and renders sales, activity and stock for admins", async () => {
  const forbidden = browser();
  await forbidden.run("renderAdmin()");
  assert.equal(forbidden.calls.length, 0);
  assert.match(forbidden.get("admin-error").textContent, /Sign in/);
  forbidden.seed({ user: customer });
  await forbidden.run("renderAdmin()");
  assert.match(forbidden.get("admin-error").textContent, /administrators/);
  const data = {
    counts: { customers: 2, orders: 3, products: 4, pending: 1 },
    sales: [{ currency: "INR", gross: 20000, refunds: 1000, net: 19000, paid_orders: 2 }],
    daily: [{ day: "2026-11-01", currency: "INR", gross: 20000, orders: 2 }],
    lowStock: [{ name: "Mug", stock: 2 }],
  };
  const b = browser({
    routes: {
      "/api/admin/dashboard": data,
      "/api/admin/audit": [
        { created_at: order.created_at, actor: "Admin", action: "refund", resource_id: order.id },
      ],
    },
  });
  b.seed({ user: { ...customer, role: "admin" } });
  await b.run("renderAdmin()");
  assert.match(b.get("admin-view").textContent, /Test sales/);
  assert.match(b.get("admin-view").textContent, /Mug: 2/);
  await b.tabs[3].onclick();
  assert.match(b.get("admin-view").textContent, /refund/);
  const empty = browser({
    routes: {
      "/api/admin/dashboard": { ...data, sales: [], daily: [], lowStock: [] },
      "/api/admin/audit": [],
    },
  });
  empty.seed({ user: { ...customer, role: "admin" } });
  await empty.run("renderAdmin()");
  assert.match(empty.get("admin-view").textContent, /No paid orders/);
  await empty.tabs[3].onclick();
  assert.match(empty.get("admin-view").textContent, /No administrator actions/);
});

test("product editing converts rupees to paise and restores failed-save controls", async () => {
  const b = browser({
    routes: {
      "/api/admin/products": [{ ...product, active: true }],
      "/api/admin/products/mug": { status: "ok" },
    },
  });
  b.seed({ user: { ...customer, role: "admin" } });
  await b.tabs[1].onclick();
  button(b.get("admin-view"), "Edit").onclick();
  assert.equal(b.get("product-editor").open, true);
  const fields = b.get("product-form").elements;
  assert.equal(fields.id.readOnly, true);
  assert.equal(fields.price.value, 129);
  b.get("product-form").data = { id: "mug", price: "150.25", stock: "8", version: "1" };
  await b.get("product-form").onsubmit(submit(b.get("product-form")));
  assert.equal(b.calls.find((c) => c.method === "PUT").body.price, 15025);
  assert.equal(b.get("product-editor").open, false);
  button(b.get("admin-view"), "Add product").onclick();
  assert.equal(fields.id.readOnly, false);
  const failing = browser({ routes: { "/api/admin/products/mug": new Error("offline") } });
  await failing.get("product-form").onsubmit(
    submit({
      data: { id: "mug", price: "1", stock: "1", version: "0" },
      elements: { active: { checked: true } },
    }),
  );
  assert.match(failing.get("product-error").textContent, /offline/);
  assert.equal(failing.get("save-product").disabled, false);
});

test("admin order actions await status changes, refunds and reconciliation", async () => {
  const rows = [
    order,
    { ...order, id: "cancel-me", status: "payment_pending", payment_status: "unpaid" },
    { ...order, id: "reconcile-me", payment_status: "initialization_unknown" },
  ];
  const routes = {
    "/api/admin/orders?page=0": { orders: rows, hasMore: true },
    "/api/admin/orders?page=1": { orders: [], hasMore: false },
  };
  for (const [id, action] of [
    [order.id, "status"],
    [order.id, "refund"],
    ["cancel-me", "status"],
    ["reconcile-me", "payment/reconcile"],
  ])
    routes["/api/admin/orders/" + id + "/" + action] = { status: "ok" };
  const b = browser({ routes });
  b.seed({ user: { ...customer, role: "admin" } });
  await b.tabs[2].onclick();
  assert.match(b.get("admin-view").textContent, /Kolkata/);
  await button(b.get("admin-view"), "Mark processing").onclick();
  assert.equal(b.calls.find((c) => c.method === "POST").body.status, "processing");
  const refund = form(find(b.get("admin-view"), (node) => node.className === "actions wrap"));
  refund.children[0].value = "Customer request";
  await refund.onsubmit(submit(refund));
  assert.equal(b.calls.at(-2).body.reason, "Customer request");
  await button(b.get("admin-view"), "Cancel unpaid order").onclick();
  assert.equal(b.calls.at(-2).body.status, "cancelled");
  const reconcile = find(
    b.get("admin-view"),
    (node) =>
      node.tagName === "form" &&
      node.children.some((child) => child.placeholder === "Verified Razorpay order_… ID"),
  );
  reconcile.children[0].value = "order_test";
  await reconcile.onsubmit(submit(reconcile));
  assert.equal(b.calls.at(-2).body.providerOrderId, "order_test");
  await button(b.get("admin-view"), "Next").onclick();
  assert.match(b.calls.at(-1).path, /page=1/);
  await button(b.get("admin-view"), "Previous").onclick();
  assert.match(b.calls.at(-1).path, /page=0/);
  const failing = browser({ routes: { "/api/mutate": new Error("offline") } });
  await failing.run("adminAction(document.getElementById('save-product'), '/mutate', {})");
  assert.match(failing.get("admin-error").textContent, /offline/);
  assert.equal(failing.get("save-product").disabled, false);
});

test("local payment success verifies proof before confirmation and tolerates cart cleanup failure", async () => {
  const proof = {
    razorpay_order_id: "order_test",
    razorpay_payment_id: "pay_test",
    razorpay_signature: "test-proof",
  };
  const b = browser({
    routes: {
      ["/api/orders/" + order.id + "/payment"]: { mode: "fixture" },
      ["/api/orders/" + order.id + "/payment/fixture-capture"]: proof,
      ["/api/orders/" + order.id + "/payment/verify"]: { status: "paid" },
      "/api/cart/items/mug": new Error("cart offline"),
    },
  });
  b.stored.set("checkout", "pending");
  b.stored.set("pending-order", order.id);
  b.context.paymentOrder = order;
  await b.run("payForOrder(paymentOrder)");
  assert.deepEqual(b.calls[2].body, proof);
  assert.equal(b.stored.size, 0);
  assert.equal(b.navigation.at(-1), "/orders/" + order.id + "?confirmed=1");
  const declined = browser({
    confirm: false,
    routes: { ["/api/orders/" + order.id + "/payment"]: { mode: "fixture" } },
  });
  declined.context.paymentOrder = order;
  await declined.run("payForOrder(paymentOrder)");
  assert.equal(declined.calls.length, 1);
  assert.equal(declined.navigation.length, 0);
});

test("Razorpay checkout passes configured identity and verifies success callback", async () => {
  let options;
  class Provider {
    constructor(value) {
      options = value;
    }
    on() {}
    open() {
      queueMicrotask(() => options.handler({ signature: "test-proof" }));
    }
  }
  const b = browser({
    provider: Provider,
    routes: {
      ["/api/orders/" + order.id + "/payment"]: {
        mode: "test",
        keyId: "rzp_test_example",
        amount: 12900,
        currency: "INR",
        providerOrderId: "order_test",
      },
      ["/api/orders/" + order.id + "/payment/verify"]: { status: "paid" },
      "/api/cart/items/mug": { items: [] },
    },
  });
  b.seed({ user: customer });
  b.context.paymentOrder = order;
  await b.run("payForOrder(paymentOrder)");
  assert.equal(options.currency, "INR");
  assert.equal(options.prefill.email, customer.email);
  assert.equal(b.calls[1].body.signature, "test-proof");
  assert.match(b.navigation.at(-1), /confirmed=1$/);
});

test("payment cancellation and failed verification never claim an order is paid", async () => {
  const routes = { ["/api/orders/" + order.id + "/payment"]: { mode: "test" } };
  class Cancelled {
    constructor(options) {
      this.options = options;
    }
    on(name, callback) {
      this.failed = callback;
    }
    open() {
      this.failed();
      this.options.modal.ondismiss();
    }
  }
  const b = browser({ provider: Cancelled, routes });
  b.seed({ user: customer });
  b.context.paymentOrder = order;
  await b.run("payForOrder(paymentOrder)");
  assert.match(b.get("status").textContent, /not completed/);
  assert.equal(b.navigation.at(-1), "/orders/" + order.id);
  assert.equal(b.calls.length, 1);
  class Rejected {
    constructor(options) {
      this.options = options;
    }
    on() {}
    open() {
      queueMicrotask(() => this.options.handler({ signature: "invalid" }));
    }
  }
  const rejected = browser({
    provider: Rejected,
    routes: {
      ...routes,
      ["/api/orders/" + order.id + "/payment/verify"]: {
        errorStatus: 400,
        error: "invalid_payment_signature",
      },
    },
  });
  rejected.seed({ user: customer });
  rejected.context.paymentOrder = order;
  await assert.rejects(rejected.run("payForOrder(paymentOrder)"), /verification failed/);
  assert.equal(rejected.navigation.length, 0);
});

test("SDK load failures can retry and an absent provider fails explicitly", async () => {
  const b = browser();
  b.head.onappend = (script) => queueMicrotask(() => script.onerror());
  await assert.rejects(b.run("loadRazorpay()"), /Unable to load/);
  b.head.onappend = (script) =>
    queueMicrotask(() => {
      b.context.window.Razorpay = function () {};
      script.onload();
    });
  await b.run("loadRazorpay()");
  assert.equal(b.head.children.length, 2);
  const missing = browser();
  missing.head.onappend = (script) => queueMicrotask(() => script.onload());
  await assert.rejects(missing.run("loadRazorpay()"), /did not load/);
});

test("unpaid receipt offers retry and keeps the order accessible if payment fails", async () => {
  const pending = { ...order, status: "payment_pending", payment_status: "unpaid" };
  const b = browser({
    routes: {
      ["/api/orders/" + order.id]: pending,
      ["/api/orders/" + order.id + "/payment"]: new Error("provider offline"),
    },
  });
  b.seed({ user: customer });
  await b.run(`renderOrder('${order.id}')`);
  const pay = button(b.get("order-detail"), "Pay with Razorpay (test)");
  await pay.onclick();
  assert.equal(pay.disabled, false);
  assert.match(b.get("status").textContent, /provider offline/);
  const legacy = browser({
    routes: { ["/api/orders/" + order.id]: { ...order, payment_status: "demo", delivery: null } },
  });
  await legacy.run(`renderOrder('${order.id}')`);
  assert.match(legacy.get("order-detail").textContent, /legacy demo/);
});
