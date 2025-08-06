import express from 'express';
import User from '../models/User.js';

const router = express.Router();

// Get or create user
router.post('/get-or-create', async (req, res) => {
  try {
    const { email } = req.body;

    if (!email) {
      return res.status(400).json({ error: 'Email is required' });
    }

    let user = await User.findOne({ email });
    
    if (!user) {
      user = new User({ email });
      await user.save();
    }

    res.json({
      id: user._id,
      email: user.email,
      createdAt: user.createdAt
    });

  } catch (error) {
    console.error('User creation error:', error);
    res.status(500).json({ error: 'Failed to get or create user' });
  }
});

export default router;