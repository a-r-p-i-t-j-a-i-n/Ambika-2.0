/**
 * Reset EVERY user's password to a simple shared value (for testing/demo).
 * Saves each user so the model's pre-save hook hashes the password correctly.
 *
 * Run:  node src/scripts/reset_all_passwords.js
 */
import mongoose from 'mongoose';
import env from '../config/env.js';
import User from '../modules/auth/auth.model.js';

const NEW_PASSWORD = '123456';

const run = async () => {
  await mongoose.connect(env.MONGO_URI);
  const users = await User.find({});
  let done = 0;
  for (const u of users) {
    u.password = NEW_PASSWORD;
    try { await u.save({ validateModifiedOnly: true }); done += 1; }
    catch (e) { console.warn(`   ⚠️  ${u.email}: ${e.message}`); }
  }
  console.log(`✅ Reset password to "${NEW_PASSWORD}" for ${done}/${users.length} users.`);
  await mongoose.connection.close();
  process.exit(0);
};

run().catch(async (err) => {
  console.error('❌ Reset failed:', err);
  await mongoose.connection.close().catch(() => {});
  process.exit(1);
});
