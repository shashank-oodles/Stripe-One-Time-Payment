import cron from 'node-cron';
import Payment from '../models/Payment.js';
import { sendExpiryWarningEmail } from './email.js';
import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

export const scheduleExpiryChecks = () => {
  // Check for expiring payments every hour
  // cron.schedule('0 * * * *', async () => {
  cron.schedule('* * * * *', async () => {

    try {
      const threeDaysFromNow = new Date();
      threeDaysFromNow.setDate(threeDaysFromNow.getDate() + 3);
      // threeDaysFromNow.setMinutes(threeDaysFromNow.getMinutes() + 2);


      const tomorrow = new Date();
      tomorrow.setDate(tomorrow.getDate() + 1);
      // tomorrow.setMinutes(tomorrow.getMinutes() + 1);


      // Send expiry warnings
      const expiringPayments = await Payment.find({
        status: 'pending',
        expiresAt: {
          $gte: tomorrow,
          $lte: threeDaysFromNow
        },
        expiryWarningEmailSent: false
      });

      for (const payment of expiringPayments) {
        try {
          await sendExpiryWarningEmail(
            payment.email,
            payment.stripePaymentLink,
            payment.amountCents / 100,
            payment.id
          );

          payment.expiryWarningEmailSent = true;
          await payment.save();

          console.log(`Expiry warning sent for payment ${payment.id}`);
        } catch (error) {
          console.error(`Failed to send expiry warning for payment ${payment.id}:`, error);
        }
      }

      // Expire and deactivate payment links
      const now = new Date();
      const expiredPayments = await Payment.find({
        status: 'pending',
        expiresAt: { $lt: now }
      });

      for (const payment of expiredPayments) {
        try {
          const linkId = payment.stripePaymentIntentId;

          console.log("LinkId: " + linkId)
          await stripe.paymentLinks.update(linkId, {
            active: false
          });

          payment.status = 'expired';
          await payment.save();

          console.log(`Marked expired and deactivated link for payment ${payment.id}`);
        } catch (error) {
          console.error(`Failed to deactivate Stripe link for ${payment.id}:`, error);
        }
      }

      console.log('Expiry check completed');
    } catch (error) {
      console.error('Expiry check error:', error);
    }
  });

  console.log('Payment expiry scheduler started');
};
