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
  firstName: {
    type: String,
    required: true,
    trim: true,
  },
  lastName: {
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
  interestList: {
    type: [String],
    default: [],
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
});
const User = mongoose.model("User", userIndex);

const underageIndex = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      unique: true,
    },
    p_email: {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
    },
    isVerified: {
      type: Boolean,
      default: false,
    },
  },
  { timestamps: true },
);
const Underage = mongoose.model("Underage", underageIndex);

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
    const { firstName, lastName, age, email, password, parentEmail } = req.body;

    if (!firstName || !lastName || !age || !email || !password) {
      return res.status(400).json({ message: "All fields are required" });
    }

    const ageNum = parseInt(age);

    // Under-18 must supply a parent/guardian email
    if (ageNum < 18 && !parentEmail) {
      return res.status(400).json({
        message: "Parent/guardian email is required for users under 18",
      });
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
      age: ageNum,
      email,
      password: hashedPassword,
    });

    await user.save();
    console.log("User registered:", email);

    // If under 18, create a linked record in the underage collection
    if (ageNum < 18) {
      await Underage.create({
        userId: user._id,
        p_email: parentEmail.trim().toLowerCase(),
        isVerified: false,
      });
      console.log("Underage record created for:", email);
    }

    res.status(201).json({
      message: "User registered successfully",
      user: {
        id: user._id,
        firstName: user.firstName,
        lastName: user.lastName,
        age: user.age,
        email: user.email,
        interestList: user.interestList || [],
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
        BookmarkedOpportunities: user.BookmarkedOpportunities || [],
        interestList: user.interestList || [],
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

// Update user detail
app.patch("/api/users/update", async (req, res) => {
  try {
    const { email, newEmail, password } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const updates = {};
    if (newEmail) updates.email = newEmail.toLowerCase().trim();
    if (password) {
      if (password.length < 6) {
        return res
          .status(400)
          .json({ message: "Password must be at least 6 characters" });
      }
      updates.password = await bcrypt.hash(password, 10);
    }

    const user = await User.findOneAndUpdate(
      { email },
      { $set: updates },
      { new: true },
    ).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log("User updated:", email);
    res.json({ message: "User updated successfully", user });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Add a bookmark
app.patch("/api/users/bookmark/add", async (req, res) => {
  try {
    const { email, jobID } = req.body;

    if (!email || !jobID) {
      return res.status(400).json({ message: "Email and jobID are required" });
    }

    const user = await User.findOneAndUpdate(
      { email },
      { $addToSet: { BookmarkedOpportunities: jobID } }, //Prevent duplicates
      { new: true },
    ).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log(`Bookmark added: ${email} -> ${jobID}`);
    res.json({
      message: "Bookmark added",
      BookmarkedOpportunities: user.BookmarkedOpportunities,
    });
  } catch (error) {
    console.error("Error adding bookmark:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Remove a bookmark
app.patch("/api/users/bookmark/remove", async (req, res) => {
  try {
    const { email, jobID } = req.body;

    if (!email || !jobID) {
      return res.status(400).json({ message: "Email and jobID are required" });
    }

    const user = await User.findOneAndUpdate(
      { email },
      { $pull: { BookmarkedOpportunities: jobID } },
      { new: true },
    ).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log(`Bookmark removed: ${email} -> ${jobID}`);
    res.json({
      message: "Bookmark removed",
      BookmarkedOpportunities: user.BookmarkedOpportunities,
    });
  } catch (error) {
    console.error("Error removing bookmark:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update interest list
app.patch("/api/users/interests", async (req, res) => {
  try {
    const { email, interestList } = req.body;

    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }
    if (!Array.isArray(interestList) || interestList.length === 0) {
      return res
        .status(400)
        .json({ message: "Please provide at least one interest" });
    }

    const user = await User.findOneAndUpdate(
      { email },
      { $set: { interestList } },
      { new: true },
    ).select("-password");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    console.log("Interests updated for:", email);
    res.json({
      message: "Interests updated successfully",
      interestList: user.interestList,
    });
  } catch (error) {
    console.error("Error updating interests:", error);
    res.status(500).json({ message: "Server error", error: error.message });
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
