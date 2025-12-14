const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const admin = require("firebase-admin");
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

    // reports related api
app.get("/reports", async (req, res) => {
  const query = {};
  const page = parseInt(req.query.page) || 1;
  const limit = parseInt(req.query.limit) || 9;
  const skip = (page - 1) * limit;

  const totalReports = await reportCollection.countDocuments();
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
      if (report.upvotedBy?.includes(userEmail)){
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
