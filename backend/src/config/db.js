import mongoose from "mongoose";
import { logger } from "../utils/logger.js";
import env from "./env.js";
import dns from "dns";
// Atlas `mongodb+srv://` needs SRV/TXT DNS lookups. Public resolvers are kept first
// (they fix the common ISP "querySrv ENOTFOUND"), but the machine's own resolvers
// are appended as fallback so a single public-DNS blip doesn't drop the connection
// and trigger a reconnect storm.
try {
  const systemDns = dns.getServers();
  dns.setServers([...new Set(["1.1.1.1", "8.8.8.8", ...systemDns])]);
} catch {
  dns.setServers(["1.1.1.1", "8.8.8.8"]);
}
const connectDB = async () => {
  try {
    const conn = await mongoose.connect(env.MONGO_URI, {
      // Modern Mongoose 8 doesn't need useNewUrlParser / useUnifiedTopology.
      maxPoolSize: 10,
      // Keep a couple of connections warm so an idle period (Atlas closes idle
      // sockets) doesn't force a cold reconnect on the next request — the main
      // cause of the "first login fails, then works" symptom.
      minPoolSize: 2,
      // Give the driver room to re-select a server during a transient blip / SRV
      // re-resolution instead of failing fast in 5s (which surfaced as a login error).
      serverSelectionTimeoutMS: 15000,
      socketTimeoutMS: 45000,
      heartbeatFrequencyMS: 10000,
      retryWrites: true,
      retryReads: true,
    });

    logger.info(
      `✅ MongoDB Connected: ${conn.connection.host}/${conn.connection.name}`,
    );

    mongoose.connection.on("error", (err) => {
      logger.error(`MongoDB connection error: ${err}`);
    });

    mongoose.connection.on("disconnected", () => {
      logger.warn("MongoDB disconnected — driver will auto-reconnect.");
    });

    mongoose.connection.on("reconnected", () => {
      logger.info("✅ MongoDB reconnected.");
    });

    return conn;
  } catch (error) {
    logger.error(`❌ MongoDB Connection Failed: ${error.message}`);
    process.exit(1);
  }
};

export default connectDB;
