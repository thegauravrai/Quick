const redisClient = require('../config/redis'); 
const Order = require('../models/Order'); 

const ORDER_STAGES = ['Received', 'Preparing', 'Cooking', 'Ready', 'Completed'];

// 1. Place a new order
exports.placeOrder = async (req, res) => {
  try {
    const { items, orderType, paymentMethod, subtotal, discount, taxes, total, promoCode } = req.body;
    
    if (!items || items.length === 0) return res.status(400).json({ message: 'No items in order' });

    // Generate unique daily token using Redis
    const dateString = new Date().toISOString().split('T')[0]; 
    const tokenKey = `order_token:${dateString}`;
    const dailyTokenNumber = await redisClient.incr(tokenKey); 
    const orderToken = `TKN-${dailyTokenNumber.toString().padStart(3, '0')}`; 

    // Dynamic Wait-Time Calculation
    const PREP_MAP = { bev: 3, snack: 5, meal: 10 };
    let totalPrep = 0;
    
    items.forEach(item => {
      totalPrep += PREP_MAP[item.type] || 5; 
    });
    
    const activeOrdersCount = await redisClient.lLen('active_kitchen_queue');
    const stations = 2; 
    const estimatedMinutes = Math.ceil(totalPrep / stations) + (activeOrdersCount * 2);

    // Create the Database Record
    const order = await Order.create({
      orderToken, 
      customer: req.user._id,
      customerName: req.user.name,
      items,
      subtotal: subtotal || total,
      discount: discount || 0,
      taxes: taxes || 0,
      total,
      orderType,
      paymentMethod,
      paymentStatus: paymentMethod === 'Cash' ? 'Pending' : 'Paid',
      estimatedMinutes,
      promoCode,
      status: 'Received',
      stageIndex: 0
    });

    // Cache the active order in Redis
    await redisClient.rPush('active_kitchen_queue', JSON.stringify(order));

    // WebSocket Broadcast
    const io = req.app.get('io');
    if (io) io.emit('new_order', order);

    res.status(201).json({ order });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// 2. Update order status (Vendor/Admin)
exports.updateStatus = async (req, res) => {
  try {
    const { status } = req.body;
    const stageIndex = ORDER_STAGES.indexOf(status);

    const order = await Order.findOneAndUpdate(
      { _id: req.params.id }, 
      { status, stageIndex: stageIndex >= 0 ? stageIndex : undefined },
      { new: true }
    );

    if (!order) return res.status(404).json({ message: 'Order not found' });

    if (status === 'Completed') {
       await redisClient.lRem('active_kitchen_queue', 0, JSON.stringify(order));
    }

    const io = req.app.get('io');
    if (io) io.emit('update_status', order);

    res.json({ order });
  } catch (err) {
    res.status(400).json({ message: err.message });
  }
};

// 3. Get logged-in user's orders
exports.getMyOrders = async (req, res) => {
  try {
    const orders = await Order.find({ customer: req.user._id }).sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 4. Get all orders (Admin/Kitchen)
exports.getAllOrders = async (req, res) => {
  try {
    const orders = await Order.find().sort({ createdAt: -1 });
    res.json(orders);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 5. Get a single order by ID
exports.getOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    res.json(order);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};

// 6. Cancel an order
exports.cancelOrder = async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) return res.status(404).json({ message: 'Order not found' });
    
    if (order.status !== 'Received' && order.status !== 'Pending') {
      return res.status(400).json({ message: 'Cannot cancel an order that is already being prepared.' });
    }

    order.status = 'Cancelled';
    await order.save();

    const io = req.app.get('io');
    if (io) io.emit('update_status', order);

    res.json({ message: 'Order cancelled', order });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
};