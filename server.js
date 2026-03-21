//This file is set up with the help of AI, and is the backend server for the application. It handles user registration, login, and profile retrieval, as well as serving job opportunities data. The server uses Express for routing, Mongoose for MongoDB interactions, and bcrypt for password hashing.
const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const bcrypt = require("bcryptjs");
require("dotenv").config();

const app = express();

app.use(cors());
app.use(express.json());

mongoose
  .connect(process.env.DB_URI)
  .then(() => {
    console.log("Connected to MongoDB");
  })
  .catch((err) => {
    console.error("Error connecting to MongoDB:", err);
  });

//User index
const userIndex = new mongoose.Schema({
  firstname: {
    type: String,
    required: true,
    trim: true,
  },
  lastname: {
    type: String,
    required: true,
    trim: true,
  },
  age: {
    type: Number,
    required: true,
    min: 1,
    max: 150,
  },

  email: {
    type: String,
    required: true,
    unique: true,
    trim: true,
    lowercase: true,
  },
  password: {
    type: String,
    required: true,
  },
  BookmarkedOpportunities: {
    type: [Number],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});
const User = mongoose.model("User", userIndex);

app.get("/", (req, res) => {
  res.json({
    message: "API is running",
    endpoints: {
      register: "POST /users/register",
      login: "POST /users/login",
      profile: "GET /users/profile?email={email}",
      opportunities: "GET /opportunities",
      opportunityById: "GET /opportunities/{jobID}",
    },
  });
});

//user registeration

app.post("/api/users/register", async (req, res) => {
  try {
    const { firstName, lastName, age, email, password } = req.body;
    if (!firstName || !lastName || !age || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const existingUser = await User.findOne({ email });
    if (existingUser) {
      return res.status(400).json({ message: "Email already in use" });
    }

    if (password.length < 6) {
      return res
        .status(400)
        .json({ message: "Password must be at least 6 characters" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = new User({
      firstName,
      lastName,
      age,
      email,
      password: hashedPassword,
    });

    await user.save();
    console.log("User registered:", email);

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        age: user.age,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Error registering user:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

//user login

app.post("/api/users/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res
        .status(400)
        .json({ message: "Email and password are required" });
    }

    const user = await User.findOne({ email });
    if (!user) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    const checkPassword = await bcrypt.compare(password, user.password);
    if (!checkPassword) {
      return res.status(401).json({ message: "Invalid email or password" });
    }

    console.log("User logged in:", email);

    res.json({
      message: "Login successful",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        age: user.age,
        email: user.email,
        bookmarks: user.bookmarks || [],
        createdAt: user.createdAt,
      },
    });
  } catch (error) {
    console.error("Login Failed:", error);
    res
      .status(500)
      .json({ message: "Server error during login", error: error.message });
  }
});

//get user info
app.get("/api/users/profile", async (req, res) => {
  try {
    const { email } = req.query;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email }).select("-password");

    if (!user) {
      return res.status(404).json({
        message: "User not found",
      });
    }

    res.json(user);
  } catch (error) {
    console.error("Profile fetch error:", error);
    res
      .status(500)
      .json({ message: "Server error fetching profile", error: error.message });
  }
});

// error handler
app.use((req, res) => {
  res.status(404).json({ message: "Endpoint not found" });
});

//Start server
const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log(`http://localhost:${PORT}`);
});
