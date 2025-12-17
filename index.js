const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const admin = require("firebase-admin");
const stripe = require('stripe')(process.env.STRIPE_SECRET);
const serviceAccount = require("./public-infrastructure-issue.json");
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

    
    // more middleware database access
    const verifyAdmin = async (req, res, next) => {
  const email = req.decoded_email;
  const user = await userCollection.findOne({ email });
  if (!user || user.role !== "admin") {
    return res.status(403).send({ message: "admin access only" });
  }
  next();
};


    // users related api
    app.post('/users',async(req,res)=>{
      const user = req.body;
      user.role = "user";
      user.createdAt = new Date()
      const email = user.email;

      const userExits = await userCollection.findOne({ email });
      if (userExits) {
        return res.send({ message: "already exists" });
      }
      const result = await userCollection.insertOne(user)
      res.send(result)
    })
// admin related api
    app.get("/admin/stats", verifyFBToken, verifyAdmin, async (req, res) => {
  const totalIssues = await reportCollection.countDocuments();
  const pending = await reportCollection.countDocuments({ status: "pending" });
  const resolved = await reportCollection.countDocuments({ status: "resolved" });
  const rejected = await reportCollection.countDocuments({ status: "rejected" });

  res.send({
    totalIssues,
    pending,
    resolved,
    rejected,
  });
});
   

    // reports related api
app.get("/reports", async (req, res) => {
  const {searchText } =req.query.searchText;
  const query = {};
  if(searchText){
    query.$or =[
      {title:{$regex: searchText,$options:'i'}},
      {category:{$regex: searchText,$options:'i'}},
      {location:{$regex: searchText,$options:'i'}},
    ]
  }
  // implement later 
  // if(filter){
  //   query.$or =[
  //     {status:{$regex: filter,$options:'i'}},
  //     {priority:{$regex: filter,$options:'i'}},
  //     {category:{$regex: filter,$options:'i'}},
  //   ]
  // }


  // if(status){
  //   query.status = status.toLowerCase()
  // }
  // if(priority){
  //   query.priority = priority.toLowerCase()
  // }
  // if(category){
  //   query.category = category.toLowerCase()
  // }

  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 9;
  const skip = (page - 1) * limit;

  const totalReports = await reportCollection.countDocuments(query);
  const result = await reportCollection
    .find(query)
    .sort({ priority: 1})
    .skip(skip)
    .limit(limit)
    .toArray();
  res.send({ result, totalReports });
});


    app.get("/reports/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await reportCollection.findOne(query);
      res.send(result);
    });

    app.patch("/reports/:id", async (req, res) => {
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
    app.post("/reports/:id/upVote",verifyFBToken,async(req,res)=>{
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



    app.post("/reports", async (req, res) => {
      const report = req.body;
      const result = await reportCollection.insertOne(report);
      res.send(result);
    });

    app.delete("/reports/:id", verifyFBToken, async (req, res) => {
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

    // payment related api 

app.post('/create-checkout-session', async (req, res) => {
  const paymentInfo = req.body;
  const session = await stripe.checkout.sessions.create({
    line_items: [
      {
        price_data:{
          currency:'bdt',
          product_data: {
            name: "Boost Issue",
            description: "Boost this issue to high priority",
          },
          unit_amount:10000
        },
        quantity: 1,
      },
    ],
    mode: 'payment',
    metadata:{
      reportId:paymentInfo.reportId
    },
    customer_email:paymentInfo.email,
    success_url: `${process.env.SITE_DOMAIN}/view-details/${paymentInfo.reportId}?session_id={CHECKOUT_SESSION_ID}`,
    // success_url: `${process.env.SITE_DOMAIN}/all-issue?session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${process.env.SITE_DOMAIN}`,
  });

  res.send({url:session.url})
});




app.post('/confirm-boost', async (req, res) => {
  const { sessionId } = req.body;

  const session = await stripe.checkout.sessions.retrieve(sessionId);

  if (session.payment_status !== "paid") {
    return res.status(400).send({ message: "Payment not completed" });
  }

  const reportId = session.metadata.reportId;

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
  // console.log('after retrieve')
  res.send({ success: true });
});



    await client.db("admin").command({ ping: 1 });
    console.log(
      "Pinged your deployment. You successfully connected to MongoDB!"
    );
  } finally {
    // Ensures that the client will close when you finish/error
    // await client.close();
  }
}
run().catch(console.dir);

app.listen(port, () => {
  console.log(`Example app listening on port ${port}`);
});
