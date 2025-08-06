import express from 'express';
import { v4 as uuidv4 } from 'uuid';
import Stripe from 'stripe';
import User from '../models/User.js';
import Payment from '../models/Payment.js';
import { sendPaymentLinkEmail } from '../utils/email.js';
import { sendPaymentSuccessEmail } from '../utils/email.js'
import axios from 'axios';

const router = express.Router();
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
const prodId = process.env.STRIPE_PRODUCT_ID;

// Create payment link
router.post('/create-payment-link', async (req, res) => {
  try {
    const { email, amount } = req.body;

    // Validate input
    if (!email || !amount || amount < 0.5) {
      return res.status(400).json({
        error: 'Email and amount (minimum $0.50) are required'
      });
    }

    const amountCents = Math.round(amount * 100);

    // Find or create user
    let user = await User.findOne({ email });
    if (!user) {
      user = new User({ email });
      await user.save();
    }

    // Create Stripe customer if not exists
    // if (!user.stripeCustomerId) {
    //   const customer = await stripe.customers.create({
    //     email: email,
    //     metadata: { userId: user._id.toString() }
    //   });
    //   user.stripeCustomerId = customer.id;
    //   await user.save();
    // }

    if (!user.stripeCustomerId) {
      // Try to find existing customer in Stripe
      const existingCustomers = await stripe.customers.list({
        email: email,
        limit: 1,
      });

      if (existingCustomers.data.length > 0) {
        user.stripeCustomerId = existingCustomers.data[0].id;
      } else {
        const customer = await stripe.customers.create({
          email: email,
          metadata: { userId: user._id.toString() },
        });
        user.stripeCustomerId = customer.id;
      }

      await user.save();
    }


    // Generate unique payment ID
    const paymentId = uuidv4();

    // Create Stripe product
    // const product = await stripe.products.create({
    //   name: 'Payment Request',
    //   description: `Payment request for ${email}`
    // });

    // Create Stripe price
    const price = await stripe.prices.create({
      unit_amount: amountCents,
      currency: 'usd',
      // product: product.id,
      product: prodId,
    });

    // const twoMinutesFromNow = Math.floor(Date.now() / 1000) + 2 * 60;
    const fiveDaysFromNow = Math.floor(Date.now() / 1000) + (5 * 24 * 60 * 60);

    const draftInvoice = await stripe.invoices.create({
      customer: user.stripeCustomerId,
      auto_advance: false,
      pending_invoice_items_behavior: 'exclude',
      collection_method: 'send_invoice',
      // due_date: twoMinutesFromNow,
      due_date: fiveDaysFromNow,
      footer: 'This invoice is valid for 5 days.',
      metadata: {
        paymentId: paymentId
      }
    });

    await stripe.invoiceItems.create({
      customer: user.stripeCustomerId,
      invoice: draftInvoice.id,
      amount: amountCents,
      currency: 'usd',
      description: 'Invoice for one-time payment via payment link',
    });

    const finalizedInvoice = await stripe.invoices.finalizeInvoice(draftInvoice.id);


    // Create Stripe payment link
    const paymentLink = await stripe.paymentLinks.create({
      line_items: [
        {
          price: price.id,
          quantity: 1,
        },
      ],
      metadata: {
        customer_id: user.stripeCustomerId,
        paymentId: paymentId,
        email: email,
        finalizedInvoiceId: finalizedInvoice.id
      },
      after_completion: {
        type: 'redirect',
        redirect: {
          url: `${process.env.FRONTEND_URL}/payment-success?id=${paymentId}`
        }
      }
    });


    // 3. Wait for invoice_pdf
    let invoice = finalizedInvoice;
    for (let i = 0; i < 5; i++) {
      invoice = await stripe.invoices.retrieve(finalizedInvoice.id);
      if (invoice.invoice_pdf) break;
      await new Promise(res => setTimeout(res, 1000)); // wait 1s
    }

    if (!invoice.invoice_pdf) {
      throw new Error('Invoice PDF not available after waiting');
    }

    // // 4. Download invoice PDF
    const pdfResponse = await axios.get(invoice.invoice_pdf, {
      responseType: 'arraybuffer'
    });

    const pdfBuffer = pdfResponse.data;

    console.log('Invoice created:', invoice.id);



    // await sendPaymentSuccessEmail(email, (amountCents / 100).toFixed(2), paymentId, pdfBuffer);

    // Save payment to database
    const payment = new Payment({
      id: paymentId,
      userId: user._id,
      email,
      amountCents,
      stripePaymentLink: paymentLink.url,
      stripePaymentIntentId: paymentLink.id,
      invoiceId: finalizedInvoice.id,
      expiresAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) // 5 days
      // expiresAt: new Date(Date.now() + 2 * 60 * 1000) // 2 minutes

    });

    await payment.save();

    // Send email with payment link
    await sendPaymentLinkEmail(email, paymentLink.url, amount, paymentId, pdfBuffer);

    res.json({
      success: true,
      paymentId,
      paymentLink: paymentLink.url,
      expiresAt: payment.expiresAt
    });

  } catch (error) {
    console.error('Payment creation error:', error);
    res.status(500).json({ error: 'Failed to create payment link' });
  }
});


// Get payment status
router.get('/status/:id', async (req, res) => {
  try {
    const payment = await Payment.findOne({ id: req.params.id });

    if (!payment) {
      return res.status(404).json({ error: 'Payment not found' });
    }

    res.json({
      id: payment.id,
      email: payment.email,
      amount: payment.amountCents / 100,
      status: payment.status,
      createdAt: payment.createdAt,
      expiresAt: payment.expiresAt,
      paidAt: payment.paidAt
    });

  } catch (error) {
    console.error('Payment status error:', error);
    res.status(500).json({ error: 'Failed to get payment status' });
  }
});

// Get payments for email
router.get('/history', async (req, res) => {
  // try {
  //   const { email } = req.query;
  //   const payments = await Payment.find({ email })
  //     .sort({ createdAt: -1 })
  //     .limit(50);

  //   const formattedPayments = payments.map(payment => ({
  //     id: payment.id,
  //     amount: payment.amountCents / 100,
  //     status: payment.status,
  //     createdAt: payment.createdAt,
  //     expiresAt: payment.expiresAt,
  //     paidAt: payment.paidAt
  //   }));

  //   res.json(formattedPayments);

  // } catch (error) {
  //   console.error('Payment history error:', error);
  //   res.status(500).json({ error: 'Failed to get payment history' });
  // }
  const { email, status, startDate, endDate } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Email parameter is required.' });
  }

  try {
    const query = { email };

    // Optional: Filter by status
    if (status) {
      query.status = status;
    }

    // Optional: Filter by date range
    if (startDate) {
      query.createdAt = query.createdAt || {};
      query.createdAt.$gte = new Date(startDate);
    }

    if (endDate) {
      query.expiresAt = query.expiresAt || {};
      query.expiresAt.$lte = new Date(endDate);
    }

    const payments = await Payment.find(query);

    const formatted = payments.map(payment => ({
      id: payment.id,
      amount: payment.amountCents / 100,
      status: payment.status,
      createdAt: payment.createdAt,
      expiresAt: payment.expiresAt,
      paidAt: payment.paidAt
    }));

    res.json(formatted);
  } catch (err) {
    console.error('Error fetching invoices:', err);
    res.status(500).json({ error: 'Server error while fetching invoices.' });
  }
});

export default router;