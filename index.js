const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const admin = require("firebase-admin");
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const serviceAccount = require("./public-infrastructure-issue.json");
// const serviceAccount = require("./firebase-admin-key.json");
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount),
});

// middleware
app.use(express.json());
app.use(cors());

const verifyFBToken = async (req, res, next) => {
  const token = req.headers.authorization;
  if (!token) {
    return res.status(401).send({ message: "unauthorized access" });
  }
  try {
    const idToken = token.split(" ")[1];
    const decoded = await admin.auth().verifyIdToken(idToken);
    req.decoded_email = decoded.email;
    next();
  } catch (err) {
    return res.status(401).send({ message: "unauthorized access" });
  }
};

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.a47ogqg.mongodb.net/?appName=Cluster0`;

app.get("/", (req, res) => {
  res.send("public infrastructure issue server in running");
});

const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  },
});

async function run() {
  try {
    await client.connect();

    const db = client.db("Public_Infrastructure");
    const reportCollection = db.collection("reports");
    const userCollection = db.collection("users");
    const paymentCollection =db.collection("payments")

    
    // more middleware database access
const verifyAdmin = async (req, res, next) => {
  try {
    const email = req.decoded_email;
    const user = await userCollection.findOne({ email });

    if (!user || user.role !== "admin") {
      return res.status(403).send({ message: "Admin access only" });
    }

    next();
  } catch (err) {
    res.status(500).send({ message: "Internal server error" });
  }
};



const checkBlockedUser = async (req, res, next) => {
  const email = req.decoded_email;

  const user = await userCollection.findOne({ email });
  if (user?.isBlocked) {
    return res.status(403).send({
      message: "You are blocked. Contact authority."
    });
  }

  next();
};


// free user limit

const checkFreeUserLimit = async (req, res, next) => {
  const email = req.decoded_email;
  const user = await userCollection.findOne({ email });
  // safety
  if (!user) {
    return res.status(404).send({ message: "User not found" });
  }

  // ✅ Premium user → no limit
  if (user.isPremium) {
    return next();
  }

  // ❌ Free user → max 3 issues
  const issueCount = await reportCollection.countDocuments({ email });

  if (issueCount >= 3) {
    return res.status(403).send({
      message: "Free users can submit maximum 3 issues. Please subscribe."
    });
  }
  next();
};



    // users related api

app.get('/users',verifyFBToken,verifyAdmin, async (req, res) => {
  const result = await userCollection.find({ role: "citizen" }).sort({createdAt : -1}).toArray();
  res.send(result);
});

// For citizen only: get own status
app.get("/user/status", verifyFBToken, async (req, res) => {
  const email = req.decoded_email;
  const user = await userCollection.findOne({ email });
  res.send({
    isBlocked: user?.isBlocked || false,
    isPremium: user?.isPremium || false,
  });
});


// user role api

app.get("/users/:email/role", async (req, res) => {
      const email = req.params.email;
      const query = { email };
      const user = await userCollection.findOne(query);
      res.send({ role: user?.role || "citizen" });
    });



// block user api

app.patch('/users/block/:id',verifyFBToken,verifyAdmin, async (req,res)=>{
  const id = req.params.id;
  const query ={_id: new ObjectId(id)}
  const updateDoc ={
 $set: { isBlocked: true } 
  }
  const result = await userCollection.updateOne(query,updateDoc)
  res.send(result)
})

// unblock user api

app.patch('/users/unblock/:id',verifyFBToken,verifyAdmin, async (req,res)=>{
  const id = req.params.id;
  const query ={_id: new ObjectId(id)}
  const updateDoc ={
 $set: { isBlocked: false } 
  }
  const result = await userCollection.updateOne(query,updateDoc)
  res.send(result)
})

// staff related api
    app.get('/staff', verifyFBToken,verifyAdmin, async (req, res) => {
  const result = await userCollection
    .find({ role: "staff" })
    .toArray();

  res.send(result);
});


    app.post('/users',async(req,res)=>{
      const user = req.body;
      user.role = "citizen";
       user.isPremium = false;   
      user.isBlocked = false;
      user.createdAt = new Date()
      const email = user.email;

      const userExits = await userCollection.findOne({ email });
      if (userExits) {
        return res.send({ message: "already exists" });
      }
      const result = await userCollection.insertOne(user)
      res.send(result)
    })
    // staff related api 
    
    app.get('/staff/issues',async (req,res)=>{
      const {staffEmail,status,priority} =req.query
      const query ={}
      if(staffEmail){
        query.staffEmail = staffEmail
      }
      if(status){
        query.status = status
      }
      if (priority){
        query.priority = priority
      }

      const result = await reportCollection.find(query).sort({priority: 1}).toArray()
        res.send(result)
      
    })
    const validStatusFlow = {
  pending: ["in-progress"],
  "in-progress": ["working"],
  working: ["resolved"],
  resolved: ["closed"],
};
    //  status related api 
app.patch("/staff/issues/status/:id", async (req, res) => {
  try {
    const issueId = req.params.id;
    const { newStatus, staffEmail, staffName } = req.body;

    // 🔹 Basic validation
    if (!newStatus || !staffEmail) {
      return res.status(400).send({
        message: "newStatus and staffEmail are required",
      });
    }

    // 🔹 Find issue
    const issue = await reportCollection.findOne({
      _id: new ObjectId(issueId),
    });

    if (!issue) {
      return res.status(404).send({ message: "Issue not found" });
    }

    const currentStatus = issue.status;

    // 🔹 Status transition validation
    if (
      !validStatusFlow[currentStatus] ||
      !validStatusFlow[currentStatus].includes(newStatus)
    ) {
      return res.status(400).send({
        message: `Invalid status change from ${currentStatus} to ${newStatus}`,
      });
    }

    // 🔹 Timeline entry (match frontend)
    const timelineEntry = {
      action: "Status Changed",
      to: newStatus,
      changedBy: staffEmail,
      staffName,
      date: new Date(),
    };

    // 🔹 Update DB
    await reportCollection.updateOne(
      { _id: new ObjectId(issueId) },
      {
        $set: { status: newStatus },
        $push: { timeline: timelineEntry },
      }
    );

    // 🔹 Response (frontend does optimistic update)
    res.send({
      message: "Status updated successfully",
      status: newStatus,
    });
  } catch (error) {
    console.error("Status update error:", error);
    res.status(500).send({ message: "Status update failed" });
  }
});

app.patch("/staff/update/profile", verifyFBToken, async (req, res) => {
  const email = req.decoded_email;
  const updateStaff = req.body
  const citizen = await userCollection.findOne({ email, role: "staff" });

  if (!citizen) return res.status(404).send({ message: "staff not found" });

  const updateDoc ={
    $set:updateStaff,
    $currentDate: {updatedAt:true},
  };

  const result = await userCollection.updateOne({ email, role: "staff" }, updateDoc);
  res.send(result);
});

app.patch("/staff/:id", verifyFBToken, verifyAdmin, async (req, res) => {
  const id = req.params.id;
  const updateStaff =req.body;
  const query={_id: new ObjectId(id)}
  const updateDoc ={
    $set:updateStaff,
    $currentDate: {updatedAt:true},
  }
  const result =await userCollection.updateOne(query,updateDoc)
  res.send(result)
});

// admin related api
// get admin info

   app.get("/admin/me", verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const email = req.decoded_email;

    const admin = await userCollection.findOne({ email, role: "admin" });

    if (!admin) {
      return res.status(404).send({ message: "Admin not found" });
    }

    res.send(admin);
  } catch (err) {
    res.status(500).send({ message: "Failed to fetch admin data" });
  }
});

   app.get("/admin/stats", verifyFBToken, verifyAdmin, async (req, res) => {
  const totalIssues = await reportCollection.countDocuments();
  const pending = await reportCollection.countDocuments({ status: "pending" });
  const resolved = await reportCollection.countDocuments({ status: "resolved" });
  const rejected = await reportCollection.countDocuments({ status: "rejected" });

  res.send({totalIssues,pending,resolved,rejected});
});

app.get('/admin/total-payment', verifyFBToken, verifyAdmin, async (req, res) => {
  try {
    const payments = await paymentCollection.find({ paymentStatus: "paid" }).toArray();

    const totalAmount = payments.reduce(
      (sum, payment) => sum + payment.amount,
      0
    );

    res.send({
      totalPaymentAmount: totalAmount
    });
  } catch (error) {
    res.status(500).send({ message: error.message });
  }
});
app.get("/admin/payment", verifyFBToken, verifyAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const category = req.query.category; // get category from query

  const skip = (page - 1) * limit;

  // Build filter object
  const filter = {};
  if (category && category !== "all") {
    filter.Category = category;
  }

  const total = await paymentCollection.countDocuments(filter);

  const payments = await paymentCollection
    .find(filter)
    .sort({ createdAt: -1 })
    .skip(skip)
    .limit(limit)
    .toArray();

  res.send({
    payments,
    total,
    page,
    totalPages: Math.ceil(total / limit),
  });
});

app.get('/admin/latest/payments',verifyFBToken,verifyAdmin, async (req,res)=>{
  const result =await paymentCollection.find().sort({createdAt: -1}).limit(6).toArray()
  res.send(result)
})

// Latest Issues
app.get("/admin/latest-issues",verifyFBToken,verifyAdmin, async (req, res) => {
  const issues = await reportCollection
    .find()
    .sort({ createdAt: -1 })
    .limit(6)
    .toArray();

  res.send(issues);
});




app.patch("/admin/update", verifyFBToken, verifyAdmin, async (req, res) => {
  const email = req.decoded_email;
  const updateAdmin = req.body
  const admin = await userCollection.findOne({ email, role: "admin" });

  if (!admin) return res.status(404).send({ message: "Admin not found" });

  const updateDoc ={
    $set:updateAdmin,
    $currentDate: {updatedAt:true},
  };

  const result = await userCollection.updateOne({ email, role: "admin" }, updateDoc);
  res.send(result);
});
 
app.patch('/reports/:id/staff', verifyFBToken, verifyAdmin, async (req, res) => {
  const { name, email, staffId } = req.body;
  const reportId = req.params.id;

  const report = await reportCollection.findOne({ _id: new ObjectId(reportId) });
  if (!report) return res.status(404).send({ message: "Report not found" });
  if (report.staffId) return res.status(400).send({ message: "Staff already assigned" });

  // Update report with staff info and push timeline entry
  const updateReportDoc = {
    $set: {
      staffId,
      assignStatus:'staff-assign',
      staffName: name,
      staffEmail: email,
    },
    $push: {
      timeline: {
        date: new Date(),
        action: `Assigned to ${name}`
      }
    }
  };

  await reportCollection.updateOne(
    { _id: new ObjectId(reportId) },
    updateReportDoc
  );

  // Optional: Update staff document with assigned issue
  const staffUpdateDoc = {
    $set: {
      issueId: report._id,
      issueTitle: report.title,
      assignedDate: new Date()
    }
  };

  const staffResult = await userCollection.updateOne(
    { _id: new ObjectId(staffId) },
    staffUpdateDoc
  );

  res.send({ success: true, staffResult });
});



app.patch("/reports/:id/reject",
  verifyFBToken,
  verifyAdmin,
  async (req, res) => {

    const id = req.params.id;

    await reportCollection.updateOne(
      { _id: new ObjectId(id), status: "pending" },
      {
        $set: { status: "rejected" },
        $push: {
          timeline: {
            action: "Rejected",
            message: "Issue rejected by admin",
            date: new Date(),
          },
        },
      }
    );

    res.send({ success: true });
});

app.delete('/staff/:id',verifyFBToken,verifyAdmin, async(req,res)=>{
  const id =req.params.id;
  const query={_id: new ObjectId(id)}
  const staff = await userCollection.findOne(query)
  if(!staff){
    return res.status(404).send({ message: "Staff not found" });
  }
  if(staff.role !== 'staff'){
    return res.status(403).send({message:'You can only delete staff'})
  }
  const result = await userCollection.deleteOne(query)
  res.send(result)
})

// citizen related api 

app.get('/citizen/profile',verifyFBToken, async (req,res)=>{
  const email =req.decoded_email;
  const result = await userCollection.findOne({email})
  res.send(result)
})

app.get("/citizen/stats", verifyFBToken, async (req, res) => {
  try {
    const citizen = req.decoded_email;

    const totalIssues = await reportCollection.countDocuments({ email: citizen });
    const pending = await reportCollection.countDocuments({
      email: citizen,
      status: "pending",
    });
    const inProgress = await reportCollection.countDocuments({
      email: citizen,
      status: "in-progress",
    });
    const resolved = await reportCollection.countDocuments({
      email: citizen,
      status: "resolved",
    });
    const rejected = await reportCollection.countDocuments({
      email: citizen,
      status: "rejected",
    });

    // 📊 Monthly Issue Chart
    const monthlyIssues = await reportCollection.aggregate([
  { $match: { email: citizen } },
  {
    $addFields: {
      createdAtDate: { $toDate: "$createdAt" }
    }
  },
  {
    $group: {
      _id: { $month: "$createdAtDate" },
      count: { $sum: 1 }
    }
  },
  { $sort: { "_id": 1 } }
]).toArray();


    const monthNames = [
      "Jan","Feb","Mar","Apr","May","Jun",
      "Jul","Aug","Sep","Oct","Nov","Dec"
    ];

    const monthlyChart = monthlyIssues.map(item => ({
      month: monthNames[item._id - 1],
      count: item.count,
    }));

    res.send({
      totalIssues,
      pending,
      inProgress,
      resolved,
      rejected,
      monthlyChart,
    });
  } catch (err) {
    console.error(err);
    res.status(500).send({ message: "Server error" });
  }
});


app.get("/my-report", verifyFBToken, async (req, res) => {
  try{
    const { status, category } = req.query;

  const email = req.decoded_email

  // 🔐 base query (logged-in user only)
  const query = {
    email: email,
  };

  // 🔍 filters
  if (status) query.status = status;
  if (category) query.category = category;



  const result = await reportCollection
    .find(query)
    .sort({ createdAt: -1 })
    .toArray();

  res.send(result);
  } catch(err){
 res.status(500).send({ message: "Internal Server Error" });
  }
});

app.patch("/citizen/update", verifyFBToken, async (req, res) => {
  const email = req.decoded_email;
  const updateCitizen = req.body
  const citizen = await userCollection.findOne({ email, role: "citizen" });

  if (!citizen) return res.status(404).send({ message: "Citizen not found" });

  const updateDoc ={
    $set:updateCitizen,
    $currentDate: {updatedAt:true},
  };

  const result = await userCollection.updateOne({ email, role: "citizen" }, updateDoc);
  res.send(result);
});




app.get("/reports", async (req, res) => {
  const { searchText, status, priority, category } = req.query;
  const query = {};

  // 🔍 Search
  if (searchText) {
    query.$or = [
      { title: { $regex: searchText, $options: "i" } },
      { category: { $regex: searchText, $options: "i" } },
      { location: { $regex: searchText, $options: "i" } },
    ];
  }

  // ✅ Exact filters
  if (status) query.status = status;
  if (priority) query.priority = priority;
  if (category) query.category = category;

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 9;
  const skip = (page - 1) * limit;

  const sortQuery = { isBoosted: -1, priority: 1, createdAt: -1 };

  const totalReports = await reportCollection.countDocuments(query);
  const result = await reportCollection
    .find(query)
    .sort(sortQuery)
    .skip(skip)
    .limit(limit)
    .toArray();

  res.send({ result, totalReports });
});

app.get('/home/reports',async(req,res)=>{
  const result = await reportCollection.find().sort({createdAt: -1}).limit(6).toArray()
  res.send(result)
})
app.get("/my-reports/count", verifyFBToken, async (req, res) => {
  const email = req.decoded_email;
  const count = await reportCollection.countDocuments({ email });
  res.send({ count });
});
app.get("/report/latest-resolved", async (req, res) => {
  try {
    const result = await reportCollection
      .find({ status: "resolved" }) 
      .sort({ resolvedAt: -1 })     
      .limit(6)                     
      .toArray();

    res.send(result);
  } catch (error) {
    res.status(500).send({ message: "Failed to load resolved issues" });
  }
});




// GET /reports/admin?page=1&limit=10
app.get("/reports/admin",verifyFBToken,verifyAdmin, async (req, res) => {
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 10;
  const skip = (page - 1) * limit;

  const total = await reportCollection.countDocuments();
  const issues = await reportCollection.find().sort({priority: 1}).skip(skip).limit(limit).toArray();

  res.send({ total, page, limit, issues });
});



    app.get("/reports/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await reportCollection.findOne(query);
      res.send(result);
    });

    app.patch("/reports/:id",verifyFBToken,checkBlockedUser, async (req, res) => {
      const id = req.params.id;
      const updateReports = req.body;
      const query = { _id: new ObjectId(id) };
      const update = {
        $set: updateReports,
        $currentDate: { updatedAt: true },
      };
      const result = await reportCollection.updateOne(query, update);
      res.send(result);
    });
    app.post("/reports/:id/upVote",verifyFBToken,checkBlockedUser,async(req,res)=>{
      const id =req.params.id;
      const userEmail = req.decoded_email;
      const query = {_id: new ObjectId(id)}
      const report = await reportCollection.findOne({_id: new ObjectId(id)})
      if(!report){
        return res.status(404).send({message: 'Report not found'})
      }
      if(report.email === userEmail){
        return res.status(403).send({message:"Cannot upvote your own issue"})
      }
      if (report.upVotedBy?.includes(userEmail)){
        return res.status(400).send({ message: "Already upvoted" });
      }
      const updateDoc={
        $inc: { upVotes: 1 },
      $push: { upVotedBy: userEmail },
      $currentDate: { updatedAt: true },
      }
      const result = await reportCollection.updateOne(query,updateDoc)
      res.send({ message: "Upvoted successfully", upVotes: report.upVotes + 1 });
    })
    app.post("/reports",verifyFBToken,checkBlockedUser,checkFreeUserLimit,async (req, res) => {
    const report = req.body;
    report.email = req.decoded_email;

    const result = await reportCollection.insertOne(report);
    res.send(result);
  }
);


    app.delete("/reports/:id", verifyFBToken,checkBlockedUser, async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const report = await reportCollection.findOne(query);
      if (!report) {
        return res.status(404).send({ message: "Reports not found" });
      }
      // ✅ REAL ownership check
      if (report.email !== req.decoded_email) {
        return res.status(403).send({ message: "forbidden access" });
      }
      // (Optional) only pending reports can be deleted
      if (report.status !== "pending") {
        return res
          .status(403)
          .send({ message: "Cannot delete resolved issue" });
      }

      const result = await reportCollection.deleteOne(query);
      res.send(result);
    });
    // subscription related api

    app.post('/create-checkout-subscribe',verifyFBToken,checkBlockedUser,async (req, res) => {
     const { citizenId, email,photoURL,displayName } = req.body;
    if (!citizenId || !email) {
      return res.status(400).send({ message: "citizenId or email missing" });
    }
    const amount = 1000 * 100;
    const user = await userCollection.findOne({ email });
    if (user.isPremium) {
      return res.status(400).send({
        message: "Citizen already premium",
      });
    }
    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: 'bdt',
            product_data: {
              name: "Premium Subscription",
              description: "Unlimited issue submission access",
            },
            unit_amount: amount
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      metadata: {
        email:email,
        citizenId:citizenId,
        displayName: displayName || "",
        photoURL:photoURL || "",
        Category:"subscription"
      },

    customer_email:email,
      success_url: `${process.env.SITE_DOMAIN}/dashboard/citizen-profile/?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}/subscription-cancel`,
    });
    res.send({ url: session.url });
  }
);

app.patch('/confirm-subscribe', verifyFBToken, checkBlockedUser, async (req, res) => {
  try {
    const { sessionId } = req.body;
    if (!sessionId) {
      return res.status(400).send({ message: "sessionId missing" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(400).send({ message: "Payment not completed" });
    }

    const citizenId = session.metadata.citizenId;
    const photoURL = session.metadata.photoURL;
    const displayName = session.metadata.displayName;
     const Category = session.metadata.Category;


    // Update user only if not already premium
    const result = await userCollection.updateOne(
      { _id: new ObjectId(citizenId), isPremium: { $ne: true } },
      { $set: { isPremium: true } }
    );

    if (result.modifiedCount === 0) {
      return res.send({ message: "Already premium" });
    }
    // Payment record insert
    const payment = {
      email:req.decoded_email,
      amount: session.amount_total / 100,
      currency: session.currency,
      sessionId,
      displayName,
      photoURL,
      Category,
      paymentStatus: session.payment_status,
      createdAt: new Date(),
    };

    const resultPayment = await paymentCollection.insertOne(payment);
    return res.send({ success: true, modifyUser: result, paymentInfo: resultPayment });
    
  } catch (error) {
    console.error(error);
    return res.status(500).send({ message: error.message });
  }
});

// issue boost related api
app.post('/create-checkout-session', verifyFBToken, checkBlockedUser, async (req, res) => {
  try {
    const { reportId, email,displayName,photoURL } = req.body;

    if (!reportId || !email) {
      return res.status(400).send({ message: "reportId or email missing" });
    }

    const session = await stripe.checkout.sessions.create({
      line_items: [
        {
          price_data: {
            currency: 'bdt',
            product_data: {
              name: "Boost Issue",
              description: "Boost this issue to high priority",
            },
            unit_amount: 10000,
          },
          quantity: 1,
        },
      ],
      mode: 'payment',
      metadata: {
  reportId: String(reportId),
  displayName: displayName || "",
  photoURL: photoURL || "",
  Category:"boost"
},
      customer_email: email,
      success_url: `${process.env.SITE_DOMAIN}/view-details/${reportId}?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.SITE_DOMAIN}`,
    });

    res.send({ url: session.url });
  } catch (error) {
    console.error("CHECKOUT SESSION ERROR:", error.message);
    res.status(500).send({ message: "Failed to create checkout session" });
  }
});

app.patch('/confirm-boost', verifyFBToken, checkBlockedUser, async (req, res) => {
  try {
    const { sessionId } = req.body;

    if (!sessionId) {
      return res.status(400).send({ message: "sessionId missing" });
    }

    const session = await stripe.checkout.sessions.retrieve(sessionId);

    if (session.payment_status !== "paid") {
      return res.status(400).send({ message: "Payment not completed" });
    }

    const reportId = session.metadata.reportId;
    const displayName = session.metadata.displayName || "";
    const photoURL = session.metadata.photoURL || "";
     const Category = session.metadata.Category;

    // Update report priority
    await reportCollection.updateOne(
      { _id: new ObjectId(reportId) },
      {
        $set: { priority: "high" },
        $push: {
          timeline: {
            action: "Boosted",
            message: "Issue boosted after successful payment (100tk)",
            date: new Date()
          }
        }
      }
    );

    // Duplicate prevention: check if payment already exists
    const existingPayment = await paymentCollection.findOne({ sessionId });
    let resultPayment = null;
    if (!existingPayment) {
      const payment = {
      email:req.decoded_email,
        reportId,
        displayName,
        photoURL,
        Category,
        amount: session.amount_total / 100,
        currency: session.currency,
        sessionId,
        paymentStatus: session.payment_status,
        createdAt: new Date(),
      };
      resultPayment = await paymentCollection.insertOne(payment);
    }

    return res.send({ success: true, paymentInfo: resultPayment });
    
  } catch (error) {
    console.error(error);
    return res.status(500).send({ message: error.message });
  }
});

    // await client.db("admin").command({ ping: 1 });
    // console.log(
    //   "Pinged your deployment. You successfully connected to MongoDB!"
    // );
  } finally {
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
