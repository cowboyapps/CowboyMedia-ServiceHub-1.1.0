import { storage } from "./storage";
import { db } from "./db";
import { users } from "@shared/schema";
import crypto from "crypto";
import { promisify } from "util";

const scryptAsync = promisify(crypto.scrypt);

async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16).toString("hex");
  const derivedKey = (await scryptAsync(password, salt, 64)) as Buffer;
  return `${salt}:${derivedKey.toString("hex")}`;
}

export async function seed() {
  const existingUsers = await storage.getAllUsers();
  if (existingUsers.length > 0) {
    const protectedMasterAdmins = ["admin", "cowboy"];
    for (const username of protectedMasterAdmins) {
      const user = existingUsers.find(u => u.username.toLowerCase() === username.toLowerCase());
      if (user && user.role !== "master_admin") {
        await storage.updateUser(user.id, { role: "master_admin" });
        console.log(`Upgraded ${user.username} to master_admin role`);
      }
    }
    return;
  }

  console.log("Seeding database...");

  const adminPassword = await hashPassword("admin123");
  const customerPassword = await hashPassword("password123");

  const admin = await storage.createUser({
    username: "admin",
    password: adminPassword,
    email: "admin@servicehub.com",
    fullName: "System Admin",
    role: "master_admin",
    theme: "light",
  });

  const customer1 = await storage.createUser({
    username: "jsmith",
    password: customerPassword,
    email: "john@example.com",
    fullName: "John Smith",
    role: "customer",
    theme: "light",
  });

  const customer2 = await storage.createUser({
    username: "sjohnson",
    password: customerPassword,
    email: "sarah@example.com",
    fullName: "Sarah Johnson",
    role: "customer",
    theme: "light",
  });

  const svc1 = await storage.createService({
    name: "Cloud Hosting",
    description: "Managed cloud hosting infrastructure with 99.9% uptime guarantee",
    status: "operational",
    category: "Infrastructure",
  });

  const svc2 = await storage.createService({
    name: "Email Service",
    description: "Enterprise email delivery and inbox management platform",
    status: "operational",
    category: "Communication",
  });

  const svc3 = await storage.createService({
    name: "Database Platform",
    description: "Managed PostgreSQL and MySQL database clusters",
    status: "operational",
    category: "Data",
  });

  const svc4 = await storage.createService({
    name: "CDN Network",
    description: "Global content delivery network for fast asset loading",
    status: "operational",
    category: "Infrastructure",
  });

  const svc5 = await storage.createService({
    name: "API Gateway",
    description: "Centralized API management, rate limiting, and analytics",
    status: "degraded",
    category: "Infrastructure",
  });

  const alert1 = await storage.createAlert({
    title: "API Gateway Elevated Latency",
    description: "We are investigating reports of increased response times on the API Gateway service. Some requests may experience delays of up to 2 seconds.",
    severity: "warning",
    status: "investigating",
    serviceId: svc5.id,
  });

  await storage.createAlertUpdate({
    alertId: alert1.id,
    message: "We have identified elevated latency on API Gateway endpoints in the US-East region. Our engineering team is investigating the root cause.",
    status: "investigating",
  });

  await storage.createAlertUpdate({
    alertId: alert1.id,
    message: "The issue has been traced to a misconfigured load balancer. We are applying a fix now.",
    status: "identified",
  });

  await storage.createNewsStory({
    title: "Platform Maintenance Window Scheduled",
    content: "We will be performing scheduled maintenance on our cloud hosting infrastructure on March 1st from 2:00 AM to 4:00 AM UTC. During this window, you may experience brief interruptions to service. This maintenance is necessary to apply important security updates and improve system performance.\n\nWhat to expect:\n- Brief service interruptions (less than 5 minutes total)\n- Improved performance after maintenance\n- No data loss or configuration changes\n\nWe recommend scheduling any critical operations outside of this maintenance window. Thank you for your patience.",
    authorId: admin.id,
  });

  await storage.createNewsStory({
    title: "New CDN Edge Locations Now Available",
    content: "We are excited to announce the addition of 5 new CDN edge locations in Asia-Pacific, bringing our total global presence to 45 locations. This expansion significantly reduces latency for users in Southeast Asia, Japan, and Australia.\n\nNew locations include:\n- Tokyo, Japan\n- Singapore\n- Sydney, Australia\n- Mumbai, India\n- Seoul, South Korea\n\nThese new edge locations are already active and serving content. No configuration changes are needed on your end.",
    authorId: admin.id,
  });

  await storage.createNewsStory({
    title: "Enhanced Security Features Released",
    content: "We have released several new security features across our platform to better protect your data and services. These include advanced threat detection, automated security scanning, and enhanced access controls.\n\nKey improvements:\n- Real-time threat detection and alerting\n- Automated vulnerability scanning for all hosted applications\n- Two-factor authentication enforcement options\n- Enhanced audit logging with 90-day retention\n\nAll features are available immediately at no additional cost.",
    authorId: admin.id,
  });

  await storage.updateUser(customer1.id, { subscribedServices: [svc1.id, svc2.id, svc5.id] });
  await storage.updateUser(customer2.id, { subscribedServices: [svc1.id, svc3.id, svc4.id] });

  const ticket1 = await storage.createTicket({
    subject: "Cannot connect to database cluster",
    description: "I'm unable to connect to my PostgreSQL database cluster since this morning. Connection timeouts after 30 seconds. I've verified my credentials and firewall rules are correct.",
    serviceId: svc3.id,
    priority: "high",
    customerId: customer1.id,
    status: "open",
    imageUrl: null,
  });

  await storage.createTicketMessage({
    ticketId: ticket1.id,
    senderId: customer1.id,
    message: "I've tried connecting from both my local machine and our production server. Same timeout issue on both.",
    imageUrl: null,
  });

  await storage.createTicketMessage({
    ticketId: ticket1.id,
    senderId: admin.id,
    message: "Thank you for reporting this. I can see there was a brief network issue in the US-West region. I've applied a fix and the connections should be restored now. Can you try connecting again?",
    imageUrl: null,
  });

  console.log("Seeding complete!");
  console.log("Admin login: admin / admin123");
  console.log("Customer login: jsmith / password123");
}
