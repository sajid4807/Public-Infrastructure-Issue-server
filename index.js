const express = require("express");
const app = express();
const cors = require("cors");
require("dotenv").config();
const { MongoClient, ServerApiVersion, ObjectId } = require("mongodb");
const port = process.env.PORT || 3000;

// middleware
app.use(express.json());
app.use(cors());

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
      const result = await reportCollection.find(query).toArray();
      res.send(result);
    });

    app.get("/reports/:id", async (req, res) => {
      const id = req.params.id;
      const query = { _id: new ObjectId(id) };
      const result = await reportCollection.findOne(query);
      res.send(result);
    });

    app.patch('/reports/:id',async(req,res)=>{
      const id =req.params.id;
      const updateReports = req.body
      const query ={_id: new ObjectId(id)}
      const update ={
        $set:updateReports,
        $currentDate:{updatedAt: true}
      } 
      const result =await reportCollection.updateOne(query,update)
      res.send(result)
    })
    app.post("/reports", async (req, res) => {
      const report = req.body;
      const result = await reportCollection.insertOne(report);
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
