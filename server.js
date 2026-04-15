const express = require("express");
const mongoose = require("mongoose");
const cors = require("cors");
const nodemailer = require("nodemailer");
const crypto = require("crypto");
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

// Underage user index
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
  },
  { timestamps: true },
);
const Underage = mongoose.model("Underage", underageIndex);

// Approval request index
const approvalRequestSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    jobID: { type: Number, required: true },
    opportunity: { type: Object, required: true }, // snapshot of the opportunity
    token: { type: String, required: true, unique: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected"],
      default: "pending",
    },
  },
  { timestamps: true },
);

const ApprovalRequest = mongoose.model(
  "ApprovalRequest",
  approvalRequestSchema,
);

const transporter = nodemailer.createTransport({
  service: "gmail",
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

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

// POST /api/apply-request
// Called every time an underage user taps Apply
app.post("/api/apply-request", async (req, res) => {
  try {
    const { userId, opportunity } = req.body;

    const underageRecord = await Underage.findOne({ userId });
    if (!underageRecord) {
      return res.status(404).json({ message: "No underage record found" });
    }

    // Check if there's already a pending request for this job
    const existing = await ApprovalRequest.findOne({
      userId,
      jobID: opportunity.jobID,
      status: "pending",
    });
    if (existing) {
      return res.json({ alreadySent: true });
    }

    // Check if already approved for this specific job
    const alreadyApproved = await ApprovalRequest.findOne({
      userId,
      jobID: opportunity.jobID,
      status: "approved",
    });
    if (alreadyApproved) {
      return res.json({ approved: true });
    }

    const token = crypto.randomBytes(32).toString("hex");

    await ApprovalRequest.create({
      userId,
      jobID: opportunity.jobID,
      opportunity,
      token,
      status: "pending",
    });

    const user = await User.findById(userId);
    const approveLink = `${process.env.SERVER_URL}/api/approve/${token}`;

    const htmlEmail = `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: auto; padding: 20px;">
        <h2 style="color: #1a1a2e;">Parental Approval Required</h2>
        <p>Your child <strong>${user.firstName} ${user.lastName}</strong> wants to volunteer for:</p>

        <div style="background: #f4f4f4; border-radius: 8px; padding: 16px; margin: 20px 0;">
          <h3 style="margin: 0 0 8px;">${opportunity.title}</h3>
          <p style="margin: 4px 0;">🏢 <strong>Organisation:</strong> ${opportunity.organisation}</p>
          <p style="margin: 4px 0;">📅 <strong>Date:</strong> ${opportunity.date}</p>
          <p style="margin: 4px 0;">⏰ <strong>Time:</strong> ${opportunity.time} (${opportunity.duration})</p>
          <p style="margin: 4px 0;">📍 <strong>Location:</strong> ${opportunity.location}</p>
          <p style="margin: 12px 0 0;">${opportunity.description}</p>
        </div>

        <a href="${approveLink}"
           style="display: inline-block; background-color: #22a861; color: white; padding: 14px 28px;
                  border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold;">
          ✅ Approve This Application
        </a>

        <p style="color: #999; font-size: 12px; margin-top: 20px;">
          If you did not expect this, you can safely ignore this email.
        </p>
      </div>
    `;

    await transporter.sendMail({
      from: `"Volunteer App" <${process.env.EMAIL_USER}>`,
      to: underageRecord.p_email,
      subject: `Approval needed: ${user.firstName} wants to volunteer at ${opportunity.organisation}`,
      html: htmlEmail,
    });

    res.json({ emailSent: true });
  } catch (error) {
    console.error("Apply request error:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// GET /api/approve/:token  — parent clicks the link
app.get("/api/approve/:token", async (req, res) => {
  try {
    const record = await ApprovalRequest.findOne({ token: req.params.token });
    if (!record) {
      return res.status(404).send("<h2>Invalid or expired approval link.</h2>");
    }

    record.status = "approved";
    await record.save();

    const opp = record.opportunity;
    res.send(`
      <div style="font-family: Arial, sans-serif; text-align: center; padding: 60px 20px;">
        <h1 style="color: #22a861;">✅ Approved!</h1>
        <p style="font-size: 18px;">You've approved the application for <strong>${opp.title}</strong>.</p>
        <p>Your child can now complete their application in the app.</p>
      </div>
    `);
  } catch (error) {
    res.status(500).send("<h2>Something went wrong.</h2>");
  }
});

// GET /api/users/approval-status?userId=...&jobID=...
// Now checks per-job approval
app.get("/api/users/approval-status", async (req, res) => {
  try {
    const { userId, jobID } = req.query;

    // If not underage, never blocked
    const underageRecord = await Underage.findOne({ userId });
    if (!underageRecord) {
      return res.json({ blocked: false, status: "not_underage" });
    }

    if (!jobID) {
      return res.json({ blocked: true, status: "underage" });
    }

    const request = await ApprovalRequest.findOne({
      userId,
      jobID: Number(jobID),
    });

    if (!request) {
      return res.json({ blocked: true, status: "no_request" });
    }

    if (request.status === "approved") {
      return res.json({ blocked: false, status: "approved" });
    }

    if (request.status === "pending") {
      return res.json({ blocked: true, status: "pending" });
    }

    res.json({ blocked: true, status: request.status });
  } catch (error) {
    res.status(500).json({ message: "Server error" });
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
