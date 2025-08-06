import mongoose from 'mongoose';

const paymentSchema = new mongoose.Schema({
  id: {
    type: String,
    required: true,
    unique: true
  },
  userId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: false
  },
  email: {
    type: String,
    required: true,
    lowercase: true,
    trim: true
  },
  amountCents: {
    type: Number,
    required: true,
    min: 50
  },
  stripePaymentLink: {
    type: String,
    required: true
  },
  stripePaymentIntentId: {
    type: String,
    default: null
  },
  invoiceId: {
    type: String,
    default: null
  },
  status: {
    type: String,
    enum: ['pending', 'paid', 'expired'],
    default: 'pending'
  },
  createdAt: {
    type: Date,
    default: Date.now
  },
  expiresAt: {
    type: Date,
    required: true
  },
  paidAt: {
    type: Date,
    default: null
  },
  expiryWarningEmailSent: {
    type: Boolean,
    default: false
  }
});


export default mongoose.model('Payment', paymentSchema);