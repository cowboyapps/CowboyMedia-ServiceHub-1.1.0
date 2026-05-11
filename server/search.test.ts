import { test } from "node:test";
import assert from "node:assert/strict";
import { runSearch, type SearchStorage } from "./search";
import type {
  Service,
  ServiceAlert,
  NewsStory,
  Ticket,
  User,
  KbArticle,
} from "../shared/schema";

function makeUser(over: Partial<User>): User {
  return {
    id: "u-x",
    username: "user",
    password: "x",
    email: "user@example.com",
    fullName: "Some User",
    role: "customer",
    adminRoleId: null,
    subscribedServices: [],
    theme: "light",
    emailNotifications: true,
    notificationPrefs: {} as any,
    createdAt: new Date(),
    setupReminderDismissed: false,
    setupReminderEmailSent: false,
    chatUsername: null,
    chatNotifications: "mentions",
    chatBanned: false,
    onboardingTourCompletedAt: null,
    ...over,
  } as User;
}

function makeTicket(over: Partial<Ticket>): Ticket {
  return {
    id: "t-x",
    subject: "Subject",
    description: "Body",
    serviceId: null,
    categoryId: null,
    status: "open",
    priority: "medium",
    customerId: "u-cust",
    claimedBy: null,
    imageUrl: null,
    resolutionNote: null,
    closedBy: null,
    createdAt: new Date(),
    closedAt: null,
    ...over,
  } as Ticket;
}

function makeService(over: Partial<Service>): Service {
  return {
    id: "s-x",
    name: "Svc",
    description: null,
    status: "operational",
    category: null,
    discordWebhookUrl: null,
    ...over,
  } as Service;
}

function makeAlert(over: Partial<ServiceAlert>): ServiceAlert {
  return {
    id: "a-x",
    title: "Alert",
    description: "desc",
    severity: "warning",
    status: "investigating",
    serviceId: "s-x",
    imageUrl: null,
    createdAt: new Date(),
    resolvedAt: null,
    ...over,
  } as ServiceAlert;
}

function makeNews(over: Partial<NewsStory>): NewsStory {
  return {
    id: "n-x",
    title: "News",
    content: "<p>hello world</p>",
    imageUrl: null,
    authorId: "u-a",
    createdAt: new Date(),
    ...over,
  } as NewsStory;
}

function makeKb(over: Partial<KbArticle>): KbArticle {
  return {
    id: "k-x",
    categoryId: "c-1",
    slug: "how-pay",
    title: "How to pay",
    summary: "Pay things",
    bodyHtml: "<p>pay</p>",
    tags: [],
    published: true,
    viewCount: 0,
    helpfulCount: 0,
    unhelpfulCount: 0,
    sortOrder: 0,
    authorId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...over,
  } as KbArticle;
}

function buildStorage(data: {
  users?: User[];
  tickets?: Ticket[];
  services?: Service[];
  alerts?: ServiceAlert[];
  news?: NewsStory[];
  articles?: KbArticle[];
}): SearchStorage & { _searchCalls: Array<{ q: string; publishedOnly: boolean | undefined }> } {
  const users = data.users ?? [];
  const tickets = data.tickets ?? [];
  const services = data.services ?? [];
  const alerts = data.alerts ?? [];
  const news = data.news ?? [];
  const articles = data.articles ?? [];
  const _searchCalls: Array<{ q: string; publishedOnly: boolean | undefined }> = [];
  return {
    _searchCalls,
    async getUser(id) {
      return users.find((u) => u.id === id);
    },
    async getAllUsers() {
      return users;
    },
    async getAllTickets() {
      return tickets;
    },
    async getTicketsByCustomer(cid) {
      return tickets.filter((t) => t.customerId === cid);
    },
    async getAllServices() {
      return services;
    },
    async getAllAlerts() {
      return alerts;
    },
    async getAllNews() {
      return news;
    },
    async searchKbArticles(q, opts) {
      _searchCalls.push({ q, publishedOnly: opts.publishedOnly });
      const needle = q.toLowerCase();
      const filtered = articles.filter(
        (a) =>
          (a.title.toLowerCase().includes(needle) ||
            (a.summary || "").toLowerCase().includes(needle) ||
            a.bodyHtml.toLowerCase().includes(needle)) &&
          (opts.publishedOnly ? a.published : true),
      );
      return filtered.slice(0, opts.limit ?? 20);
    },
  };
}

test("runSearch returns empty groups for blank query", async () => {
  const storage = buildStorage({});
  const out = await runSearch("   ", makeUser({ id: "u1" }), storage);
  assert.deepEqual(out, {
    tickets: [],
    articles: [],
    news: [],
    services: [],
    users: [],
    alerts: [],
  });
});

test("customer cannot see users group, only sees their own tickets", async () => {
  const storage = buildStorage({
    users: [
      makeUser({ id: "u1", username: "alice", fullName: "Alice" }),
      makeUser({ id: "u2", username: "bob", fullName: "Bob" }),
    ],
    tickets: [
      makeTicket({ id: "t1", subject: "Login bug", customerId: "u1" }),
      makeTicket({ id: "t2", subject: "Login broken", customerId: "u2" }),
    ],
  });
  const out = await runSearch("login", makeUser({ id: "u1", role: "customer" }), storage);
  assert.equal(out.users.length, 0);
  assert.equal(out.tickets.length, 1);
  assert.equal(out.tickets[0].id, "t1");
});

test("admin sees all tickets including customer-name match and users group", async () => {
  const storage = buildStorage({
    users: [
      makeUser({ id: "u-admin", role: "admin" }),
      makeUser({ id: "u-cust", username: "charlie", fullName: "Charlie Smith" }),
    ],
    tickets: [
      makeTicket({ id: "t1", subject: "Other", description: "x", customerId: "u-cust" }),
      makeTicket({ id: "t2", subject: "Other 2", description: "y", customerId: "u-admin" }),
    ],
  });
  const out = await runSearch("charlie", makeUser({ id: "u-admin", role: "admin" }), storage);
  assert.equal(out.users.length, 1);
  assert.equal(out.users[0].title, "Charlie Smith");
  // ticket matched via customer name
  assert.equal(out.tickets.length, 1);
  assert.equal(out.tickets[0].id, "t1");
});

test("non-master admin only sees unclaimed tickets or their own; respects category access", async () => {
  const storage = buildStorage({
    users: [makeUser({ id: "u-admin", role: "admin" })],
    tickets: [
      makeTicket({ id: "t1", subject: "alpha", claimedBy: null, categoryId: "c1" }),
      makeTicket({ id: "t2", subject: "alpha", claimedBy: "u-other", categoryId: "c1" }),
      makeTicket({ id: "t3", subject: "alpha", claimedBy: "u-admin", categoryId: "c1" }),
      makeTicket({ id: "t4", subject: "alpha", claimedBy: null, categoryId: "c2" }),
    ],
  });
  const out = await runSearch("alpha", makeUser({ id: "u-admin", role: "admin" }), storage, {
    accessibleTicketCategoryIds: ["c1"],
  });
  const ids = out.tickets.map((t) => t.id).sort();
  assert.deepEqual(ids, ["t1", "t3"]);
});

test("kb articles use publishedOnly=true for customers, false for admins", async () => {
  const storage = buildStorage({
    articles: [
      makeKb({ id: "k1", title: "Public payment", published: true }),
      makeKb({ id: "k2", title: "Draft payment", published: false, slug: "draft" }),
    ],
  });
  const cust = await runSearch("payment", makeUser({ id: "u1", role: "customer" }), storage);
  assert.equal(cust.articles.length, 1);
  assert.equal(cust.articles[0].id, "k1");
  const admin = await runSearch("payment", makeUser({ id: "u-admin", role: "admin" }), storage);
  assert.equal(admin.articles.length, 2);
  assert.equal(storage._searchCalls[0].publishedOnly, true);
  assert.equal(storage._searchCalls[1].publishedOnly, false);
});

test("services / alerts / news matched by ILIKE substring; results have proper urls", async () => {
  const storage = buildStorage({
    services: [makeService({ id: "s1", name: "Email Gateway" })],
    alerts: [makeAlert({ id: "a1", title: "Email outage", description: "smtp down" })],
    news: [makeNews({ id: "n1", title: "New EMAIL feature", content: "<b>email</b> is great" })],
  });
  const out = await runSearch("email", makeUser({ id: "u1", role: "customer" }), storage);
  assert.equal(out.services[0].url, "/services/s1");
  assert.equal(out.alerts[0].url, "/alerts/a1");
  assert.equal(out.news[0].url, "/news/n1");
});

test("limit caps each group", async () => {
  const tickets = Array.from({ length: 10 }, (_, i) =>
    makeTicket({ id: `t${i}`, subject: `match ${i}`, customerId: "u1" }),
  );
  const storage = buildStorage({ tickets });
  const out = await runSearch("match", makeUser({ id: "u1", role: "customer" }), storage, {
    limit: 3,
  });
  assert.equal(out.tickets.length, 3);
});
