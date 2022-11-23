const express = require('express')
const app = express()
const cors = require('cors')
const port = process.env.PORT || 5000;
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
const jwt = require('jsonwebtoken');
require('dotenv').config();
const stripe = require("stripe")(process.env.STRIPE_SECRET_KEY);

// midelwear

app.use(cors());
app.use(express.json());

function veryfijwt(req,res,next){
    const authHeader = req.headers.authorization;
    if(!authHeader){
      return res.status(401).send('Unauthorize access')
    }
     const token = authHeader.split(' ')[1];
     jwt.verify(token, process.env.ACCESS_TOKEN, function(err,decoded){
       if(err){
        return res.status(403).send({message: 'forbidden access'})
       }
       req.decoded=decoded;
       next();
     })

}

const uri = `mongodb+srv://${process.env.DB_USER}:${process.env.DV_PASSWORD}@cluster0.apqupzl.mongodb.net/?retryWrites=true&w=majority`;
const client = new MongoClient(uri, { useNewUrlParser: true, useUnifiedTopology: true, serverApi: ServerApiVersion.v1 });

async function run(){
    try{
        const appointmentOptionCollection = client.db('doctorPorter').collection('appointmentOption');
        const bookingsCollection = client.db('doctorPorter').collection('bookings');
        const usersCollection = client.db('doctorPorter').collection('users');
        const doctorsCollection = client.db('doctorPorter').collection('doctors');
        const paymentsCollection = client.db('doctorPorter').collection('payment');

        // admin meddelwear

        const verifyAdmin =async(req,res,next)=>{
          const decodedEmail = req.decoded.email;
          const query = { email: decodedEmail };
          const user = await usersCollection.findOne(query);

          if (user?.role !== 'admin') {
              return res.status(403).send({ message: 'forbidden access' })
          }
          next();
        }
        
        app.get('/appointmentOption', async(req,res)=>{
          const date = req.query.date;
            const query={};
            const options = await appointmentOptionCollection.find(query).toArray();
            const bookingQuery = {appointmentDate: date};
            const alreadyBook = await bookingsCollection.find(bookingQuery).toArray();

            options.forEach(option=>{
              const optionBooked = alreadyBook.filter(book=>book.treatment===option.name);
              const bookSlot = optionBooked.map(book=>book.slot);
              const remainingSlots = option.slots.filter(slot => !bookSlot.includes(slot));
              option.slots=remainingSlots;
              // console.log(date, option.name, remainingSlots.length);
              // console.log(optionBooked)
            })
            res.send(options);
        });
        app.get('/appointmentSpecialty', async (req, res) => {
          const query = {}
          const result = await appointmentOptionCollection.find(query).project({ name: 1 }).toArray();
          res.send(result);
      })
        app.get('/bookings',veryfijwt, async(req,res)=>{
          const email = req.query.email;
          // console.log('accestoken', req.headers.authorization)
          const decodedEmail=req.decoded.email;
          if(email !== decodedEmail){
            return res.status(403).send({message: 'forbidden access'});
          }
          const query = {email: email};
          const bookings = await bookingsCollection.find(query).toArray();
          res.send(bookings);
        });
        app.get('/bookings/:id', async(req,res)=>{
          const id= req.params.id;
          const query = {_id: ObjectId(id)};
          const result = await bookingsCollection.findOne(query);
          res.send(result);
        });
        app.post('/bookings', async(req,res)=>{
          const bokking = req.body;
          const query={
            appointmentDate:bokking.appointmentDate,
            email: bokking.email,
            treatment: bokking.treatment
          }
          const alreadyBooked = await bookingsCollection.find(query).toArray();
          if(alreadyBooked.length){
            const message =`you already have a booking on ${bokking.appointmentDate}`;
            return res.send({
              acknowledged:false,
              message
            });
          }
          const results = await bookingsCollection.insertOne(bokking);
          res.send(results);
        });
        app.post('/create-payment-intent', async (req, res) => {
          const booking = req.body;
          const price = booking.price;
          const amount = price * 100;

          const paymentIntent = await stripe.paymentIntents.create({
              currency: 'usd',
              amount: amount,
              "payment_method_types": [
                  "card"
              ]
          });
          res.send({
              clientSecret: paymentIntent.client_secret,
          });
        });
        app.post('/payments', async (req, res) =>{
          const payment = req.body;
          const result = await paymentsCollection.insertOne(payment);
          const id = payment.bookingId
          const filter = {_id: ObjectId(id)}
          const updatedDoc = {
              $set: {
                  paid: true,
                  transactionId: payment.transactionId
              }
          }
          const updatedResult = await bookingsCollection.updateOne(filter, updatedDoc)
          res.send(result);
      })

        app.get('/jwt',async(req,res)=>{
          const email = req.query.email;
          const query = {email: email};
          const user = await usersCollection.findOne(query);
          if(user){
            const token = jwt.sign({email},process.env.ACCESS_TOKEN,{ expiresIn: '1h' });
            return res.send({accessToken: token})
          }
          res.status(403).send({accessToken: ''})
        });
        app.get('/users', async(req,res)=>{ 
          const query = {};
          const user = await usersCollection.find(query).toArray();
          res.send(user);
        })
        app.post('/users', async(req,res)=>{
          const user = req.body;
          console.log(user);
          const results = await usersCollection.insertOne(user);
          res.send(results);
        });
        app.get('/users/admin/:email', async (req, res) => {
          const email = req.params.email;
          const query = { email }
          const user = await usersCollection.findOne(query);
          res.send({ isAdmin: user?.role === 'admin' });
      })
        app.put('/users/admin/:id',veryfijwt,verifyAdmin, async (req, res) => {

          const id = req.params.id;
          const filter = { _id: ObjectId(id) }
          const options = { upsert: true };
          const updatedDoc = {
              $set: {
                  role: 'admin'
              }
          }
          const result = await usersCollection.updateOne(filter, updatedDoc, options);
          res.send(result);
      });
      app.get('/doctors',veryfijwt,verifyAdmin, async(req,res)=>{
        const query = {};
        const doctors = await doctorsCollection.find(query).toArray();
        res.send(doctors);
      })
      app.post('/doctors',veryfijwt,verifyAdmin,async(req,res)=>{
        const doctor = req.body;
        const results = await doctorsCollection.insertOne(doctor);
        res.send(results);
      });
      app.delete('/doctors/:id',veryfijwt,verifyAdmin, async(req,res)=>{
        const id = req.params.id;
        const filter = {_id: ObjectId(id)};
        const results = await doctorsCollection.deleteOne(filter);
        res.send(results);
      });
      // temporary to update price field on appointment options
        // app.get('/addPrice', async (req, res) => {
        //     const filter = {}
        //     const options = { upsert: true }
        //     const updatedDoc = {
        //         $set: {
        //             price: 99
        //         }
        //     }
        //     const result = await appointmentOptionCollection.updateMany(filter, updatedDoc, options);
        //     res.send(result);
        // })
    }
    finally{

    }
}
run().catch(console.log)
app.get('/', (req, res) => {
  res.send('Doctor porter server is running!')
})

app.listen(port, () => {
  console.log(`Doctor porter server listening on port ${port}`)
})