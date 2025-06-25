const express = require('express');
const cors = require('cors');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const admin = require("firebase-admin");

const app = express();
const decoded = Buffer.from(process.env.FB_SERVICE_KEY, 'base64').toString('utf8');
const serviceAccount = JSON.parse(decoded);


app.use(cors({
  origin: ['https://actforbd.web.app'],
  credentials: true
}));
app.use(express.json());

admin.initializeApp({
  credential: admin.credential.cert(serviceAccount)
});


const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DB_PASS}@cluster0.o9buxjw.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0`;
const client = new MongoClient(uri, {
  serverApi: {
    version: ServerApiVersion.v1,
    strict: true,
    deprecationErrors: true,
  }
});


const verifyFirebaseToken = async (req, res, next) => {
  const authHeader = req.headers.authorization || req.headers.Authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).send("Unauthorized");
  }

  const token = authHeader.split(' ')[1];
  try {
    const decoded = await admin.auth().verifyIdToken(token);
    req.decoded = decoded;
    next();
  } catch (error) {
    return res.status(401).send({ message: 'unauthorized access' });
  }
};

const verifyTokenEmail = (req, res, next) => {
  if (req.query.email !== req.decoded.email) {
    return res.status(403).send({ message: 'forbidden access' });
  }
  next();
};

async function run() {
  try {
    const eventsCollection = client.db('actForBD').collection('events');
    const joinedEventsCollection = client.db('actForBD').collection('joinedEvent');


    app.post("/events", verifyFirebaseToken, async (req, res) => {
      const newEvent = req.body;
      const result = await eventsCollection.insertOne(newEvent);
      res.send(result);
    });

    app.get('/events', async (req, res) => {
      const { eventType, search } = req.query;
      const filter = {};

      if (eventType && eventType !== 'All') {
        filter.eventType = eventType;
      }

      if (search) {
        filter.title = { $regex: search, $options: 'i' };
      }

      const events = await eventsCollection.find(filter).toArray();
      res.send(events);
    });


    app.get('/myEvents', verifyFirebaseToken, verifyTokenEmail, async (req, res) => {
      const email = req.query.email;
      const events = await eventsCollection.find({ email }).toArray();
      res.send(events);
    });


    app.get('/events/:id', async (req, res) => {
      const id = req.params.id;
      const result = await eventsCollection.findOne({ _id: new ObjectId(id) });
      res.send(result);
    });


    app.put('/events/:id', verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const updateDoc = req.body;

      const result = await eventsCollection.updateOne(
        { _id: new ObjectId(id), email: updateDoc.email },
        { $set: updateDoc }
      );

      if (result.matchedCount === 0) {
        return res.status(403).send({ message: "Unauthorized or event not found" });
      }

      res.send(result);
    });


    app.delete('/events/:id', verifyFirebaseToken, verifyTokenEmail, async (req, res) => {
      const id = req.params.id;
      const { email } = req.query;

      const result = await eventsCollection.deleteOne({ _id: new ObjectId(id), email });
      if (result.deletedCount === 0) {
        return res.status(403).send({ message: "Unauthorized or not found" });
      }

      res.send(result);
    });


    app.get('/joinedEvent', verifyFirebaseToken, verifyTokenEmail, async (req, res) => {
      const userEmail = req.query.email;
      const events = await joinedEventsCollection.find({ userEmail }).sort({ eventDate: 1 }).toArray();
      res.send(events);
    });


    app.post('/joinedEvent', verifyFirebaseToken, async (req, res) => {
      const joinedEvent = req.body;

      const existing = await joinedEventsCollection.findOne({
        eventId: joinedEvent.eventId,
        userEmail: joinedEvent.userEmail
      });

      if (existing) {
        return res.status(400).send({ message: "User already joined this event" });
      }

      const result = await joinedEventsCollection.insertOne(joinedEvent);
      res.send(result);
    });


    app.get('/eventTypes', async (req, res) => {
      const types = await eventsCollection.distinct('eventType');
      res.send(types);
    });


    app.delete('/joinedEvent/:id', verifyFirebaseToken, async (req, res) => {
      const id = req.params.id;
      const userEmail = req.decoded.email; // from verified Firebase token

      try {
        const eventToDelete = await joinedEventsCollection.findOne({ _id: new ObjectId(id) });

        if (!eventToDelete) {
          return res.status(404).send({ message: "Joined event not found" });
        }

        if (eventToDelete.userEmail !== userEmail) {
          return res.status(403).send({ message: "Forbidden: You can't delete events joined by other users" });
        }

        const result = await joinedEventsCollection.deleteOne({ _id: new ObjectId(id) });

        res.send(result);
      } catch (error) {
        console.error("Error deleting joined event:", error);
        res.status(500).send({ message: "Server error deleting joined event" });
      }
    });



  } catch (error) {
    console.error('Error connecting to MongoDB:', error);
  }
}
run();


app.get("/", (req, res) => {
  res.send("ActForBD server is cooking 🍲");
});


module.exports = app;
