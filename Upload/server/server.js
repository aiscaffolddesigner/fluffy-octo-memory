require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { auth, RequiredScopes } = require('express-oauth2-jwt-bearer');

const mongoose = require('mongoose'); // <-- NEW: Import Mongoose
const User = require('./models/User'); // <-- NEW: Import your User model

const app = express();
const port = process.env.PORT || 3000;

// --- GLOBAL UNCAUGHT EXCEPTION & UNHANDLED REJECTION HANDLERS ---
process.on('uncaughtException', (error) => {
    console.error('SERVER CRITICAL ERROR: Unhandled Exception Caught!', error);
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('SERVER CRITICAL ERROR: Unhandled Promise Rejection at:', promise, 'reason:', reason);
    process.exit(1);
});
// --- END GLOBAL ERROR HANDLERS ---

// --- Database Connection --- // <-- NEW SECTION
const DB_URI = process.env.MONGODB_URI;
if (!DB_URI) {
    console.error("ERROR: MONGODB_URI environment variable not set. Cannot connect to database.");
    process.exit(1); // Exit if DB connection string is missing
}

mongoose.connect(DB_URI)
    .then(() => console.log('MongoDB connected successfully!'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1); // Exit if DB connection fails
    });
// --- END Database Connection ---

// --- CORS Configuration ---
const allowedOrigins = [
    'http://localhost:5173', // For local frontend development
    'https://aiscaffolddesigner.github.io',
    'https://aiscaffolddesigner.github.io/fluffy-octo-memory',
    'null'
];

app.use(cors({
    origin: function (origin, callback) {
        console.log(`CORS: Incoming request origin: ${origin}`);
        if (!origin || allowedOrigins.includes(origin)) {
            console.log(`CORS: Allowing request from origin: ${origin}`);
            return callback(null, true);
        } else {
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
            console.error(`CORS Error: ${msg}`);
            callback(new Error(msg), false);
        }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    credentials: true
}));

console.log("CORS configured for origins:", allowedOrigins.join(', '));

// --- Express Middleware ---
app.use(express.json());

// --- Auth0 Configuration ---
const AUTH0_ISSUER_BASE_URL = process.env.AUTH0_ISSUER_BASE_URL;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;

if (!AUTH0_ISSUER_BASE_URL || !AUTH0_AUDIENCE) {
    console.error("ERROR: Missing Auth0 environment variables. Please ensure AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE are set.");
    process.exit(1);
}

const checkJwt = auth({
    audience: AUTH0_AUDIENCE,
    issuerBaseURL: AUTH0_ISSUER_BASE_URL,
    tokenSigningAlg: 'RS256'
});

// --- Azure OpenAI Configuration Constants ---
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_VERSION = "2024-05-01-preview";
const AZURE_OPENAI_ASSISTANT_ID = process.env.AZURE_OPENAI_ASSISTANT_ID;

const OPENAI_API_BASE_URL = `${AZURE_OPENAI_ENDPOINT}/openai`;

if (!AZURE_OPENAI_API_KEY || !AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_ASSISTANT_ID) {
    console.error("ERROR: Missing one or more required environment variables for Azure OpenAI. Please ensure AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_ASSISTANT_ID are set.");
    process.exit(1);
}


// --- NEW: User Management Middleware ---
const ensureUserExists = async (req, res, next) => {
    const auth0Id = req.auth.payload.sub; // Auth0's unique user ID

    try {
        let user = await User.findOne({ auth0Id });

        if (!user) {
            // First time user logs in: create a new user document with default trial status
            console.log(`NEW USER: ${auth0Id}. Creating trial account.`);
            user = new User({ auth0Id }); // planStatus and trialEndsAt will use defaults from schema
            await user.save();
            console.log(`Trial account created for ${auth0Id}, trial ends: ${user.trialEndsAt}`);
        } else {
            // Existing user
            console.log(`EXISTING USER: ${auth0Id}, Plan: ${user.planStatus}, Trial ends: ${user.trialEndsAt}`);
            // Optional: Update lastLogin, etc.
        }

        // Attach the user document to the request for subsequent middleware/route handlers
        req.userRecord = user;
        next();
    } catch (error) {
        console.error('Error in ensureUserExists middleware:', error);
        res.status(500).json({ error: 'Server error during user lookup/creation' });
    }
};

// --- NEW: Plan Check Middleware ---
const checkUserPlan = async (req, res, next) => {
    const user = req.userRecord; // User document attached by ensureUserExists

    if (!user) {
        // This should theoretically not happen if ensureUserExists runs first, but as a safeguard
        console.error("User record not found in request during plan check.");
        return res.status(500).json({ error: 'User data not available for plan check.' });
    }

    const now = new Date();

    if (user.planStatus === 'trial') {
        if (user.trialEndsAt && now > user.trialEndsAt) {
            // Trial has expired
            console.log(`TRIAL EXPIRED: User ${user.auth0Id}'s trial has expired.`);
            // Update status in DB if it hasn't been already
            if (user.planStatus !== 'expired') {
                user.planStatus = 'expired';
                await user.save();
            }
            return res.status(403).json({
                error: 'Your trial has expired. Please upgrade to a premium plan.',
                planStatus: 'expired'
            });
        } else if (user.trialEndsAt) {
            // Trial is active
            const daysRemaining = Math.ceil((user.trialEndsAt.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
            console.log(`TRIAL ACTIVE: User ${user.auth0Id} has ${daysRemaining} days left.`);
            next(); // Proceed to the route handler
        } else {
            // Should not happen if trialEndsAt has a default, but a fallback
            console.warn(`User ${user.auth0Id} is 'trial' but trialEndsAt is missing. Treating as active.`);
            next();
        }
    } else if (user.planStatus === 'premium') {
        console.log(`PREMIUM USER: User ${user.auth0Id} is a premium user.`);
        next(); // Proceed to the route handler
    } else if (user.planStatus === 'expired') {
        console.log(`ACCESS DENIED: User ${user.auth0Id}'s plan is expired.`);
        return res.status(403).json({
            error: 'Your plan has expired. Please upgrade to a premium plan to continue.',
            planStatus: 'expired'
        });
    } else {
        // Handle unexpected planStatus, perhaps default to restricted access
        console.warn(`UNKNOWN PLAN STATUS: User ${user.auth0Id} has unexpected planStatus: ${user.planStatus}. Denying access.`);
        return res.status(403).json({
            error: 'Access denied due to unknown plan status. Please contact support.',
            planStatus: 'unknown'
        });
    }
};

// --- API Endpoints ---

// Optional: Basic root endpoint for connectivity testing
app.get('/', (req, res) => {
    res.status(200).send('Backend is running and accessible!');
});

// NEW: Endpoint for frontend to check user's plan status
app.get('/api/user-status', checkJwt, ensureUserExists, async (req, res) => {
    const user = req.userRecord;
    res.status(200).json({
        planStatus: user.planStatus,
        trialEndsAt: user.trialEndsAt,
        // You can add more info here like remaining credits if applicable
    });
});


// Apply `checkJwt`, `ensureUserExists`, and `checkUserPlan` to protected routes
app.post('/api/new-thread', checkJwt, ensureUserExists, checkUserPlan, async (req, res) => {
    console.log("Received request to /api/new-thread (protected)");
    const userId = req.auth.payload.sub;
    console.log("Authenticated user ID:", userId);

    // At this point, checkUserPlan has already ensured the user's plan allows access.
    // If you had a credit-based system even for premium, you'd add that check here.
    // const user = req.userRecord; // Access the user record here if needed

    try {
        const threadCreationUrl = `${OPENAI_API_BASE_URL}/threads?api-version=${AZURE_OPENAI_API_VERSION}`;
        console.log("Creating thread at URL:", threadCreationUrl);

        const response = await fetch(threadCreationUrl, {
            method: 'POST',
            headers: {
                'api-key': AZURE_OPENAI_API_KEY,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({})
        });

        if (!response.ok) {
            const errorBody = await response.json();
            throw new Error(`Failed to create thread: ${response.status} ${response.statusText} - ${errorBody.message || JSON.stringify(errorBody)}`);
        }

        const thread = await response.json();
        console.log("New thread created:", thread.id);

        // TODO: Store thread.id in your database, associated with userId, for persistence
        // (This is beyond basic plan, but good for future: associate threads with user in DB)
        // e.g., if you add a `threads: [String]` array to your User schema, you could do:
        // req.userRecord.threads.push(thread.id);
        // await req.userRecord.save();

        res.status(200).json({ threadId: thread.id });

    } catch (error) {
        console.error('Error creating thread:', error.message);
        if (error.response && error.response.data) {
            console.error('API Error Details (from response.data):', error.response.data);
        } else if (error instanceof Error) {
            console.error('Error Stack:', error.stack);
        }
        res.status(500).json({
            error: 'Failed to create thread on server',
            details: error.message,
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
});

app.post('/api/chat', checkJwt, ensureUserExists, checkUserPlan, async (req, res) => {
    const { threadId, message } = req.body;
    console.log(`Received chat request for threadId: ${threadId}, message: "${message}" (protected)`);

    const userId = req.auth.payload.sub;
    console.log("Authenticated user ID:", userId);

    if (!threadId || !message) {
        return res.status(400).json({ error: 'threadId and message are required' });
    }

    // At this point, checkUserPlan has already ensured the user's plan allows access.
    // You might add additional checks here if, for example, a 'premium' plan had a message limit.
    // For enhanced security, you should also verify that the `threadId` provided in the request
    // actually belongs to the `userId` in your database. This prevents users from using
    // other users' threads. This requires storing thread IDs with user records.
    // Example (conceptual):
    // const user = req.userRecord;
    // if (!user.threads.includes(threadId)) {
    //     return res.status(403).json({ error: 'Access to this thread is denied.' });
    // }

    try {
        // 1. Add the user's message to the thread
        const addMessageUrl = `${OPENAI_API_BASE_URL}/threads/${threadId}/messages?api-version=${AZURE_OPENAI_API_VERSION}`;
        console.log("Adding message to URL:", addMessageUrl);

        const messageResponse = await fetch(addMessageUrl, {
            method: 'POST',
            headers: {
                'api-key': AZURE_OPENAI_API_KEY,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
                role: 'user',
                content: message,
            })
        });

        if (!messageResponse.ok) {
            const errorBody = await messageResponse.json();
            throw new Error(`Failed to add message: ${messageResponse.status} ${messageResponse.statusText} - ${errorBody.message || JSON.stringify(errorBody)}`);
        }
        console.log(`Message added to thread ${threadId}`);

        // 2. Create and run the assistant on the thread
        const createRunUrl = `${OPENAI_API_BASE_URL}/threads/${threadId}/runs?api-version=${AZURE_OPENAI_API_VERSION}`;
        console.log("Creating run at URL:", createRunUrl);

        let runResponse = await fetch(createRunUrl, {
            method: 'POST',
            headers: {
                'api-key': AZURE_OPENAI_API_KEY,
                'Content-Type': 'application/json',
                'OpenAI-Beta': 'assistants=v2'
            },
            body: JSON.stringify({
                assistant_id: AZURE_OPENAI_ASSISTANT_ID,
            })
        });

        if (!runResponse.ok) {
            const errorBody = await runResponse.json();
            throw new Error(`Failed to create run: ${runResponse.status} ${runResponse.statusText} - ${errorBody.message || JSON.stringify(errorBody)}`);
        }
        let run = await runResponse.json();
        console.log(`Run created with ID: ${run.id}, status: ${run.status}, associated thread_id: ${run.thread_id}`);

        // 3. Poll the run status until it's completed or requires action
        while (run.status === 'queued' || run.status === 'in_progress' || run.status === 'requires_action') {
            await new Promise(resolve => setTimeout(resolve, 1000));

            const retrieveRunUrl = `${OPENAI_API_BASE_URL}/threads/${run.thread_id}/runs/${run.id}?api-version=${AZURE_OPENAI_API_VERSION}`;
            console.log("Polling run status at URL:", retrieveRunUrl);

            runResponse = await fetch(retrieveRunUrl, {
                method: 'GET',
                headers: {
                    'api-key': AZURE_OPENAI_API_KEY,
                    'OpenAI-Beta': 'assistants=v2'
                }
            });

            if (!runResponse.ok) {
                const errorBody = await runResponse.json();
                throw new Error(`Failed to retrieve run: ${runResponse.status} ${runResponse.statusText} - ${errorBody.message || JSON.stringify(errorBody)}`);
            }
            run = await runResponse.json();
            console.log(`Run ${run.id} status: ${run.status}`);

            if (run.status === 'requires_action' && run.required_action) {
                console.log('Run requires action (tool call(s) detected).');
                const toolOutputs = await Promise.all(
                    run.required_action.submit_tool_outputs.tool_calls.map(async (toolCall) => {
                        console.log(`Executing tool: ${toolCall.function.name} with arguments: ${toolCall.function.arguments}`);
                        let output = "Tool function executed successfully with dummy output.";
                        if (toolCall.function.name === "get_current_weather") {
                            output = JSON.stringify({ temperature: 22, unit: "celsius", description: "Sunny" });
                        } else if (toolCall.function.name === "get_time") {
                            output = new Date().toLocaleTimeString();
                        }
                        return {
                            tool_call_id: toolCall.id,
                            output: String(output),
                        };
                    })
                );

                const submitToolOutputsUrl = `${OPENAI_API_BASE_URL}/threads/${run.thread_id}/runs/${run.id}/submit_tool_outputs?api-version=${AZURE_OPENAI_API_VERSION}`;
                console.log("Submitting tool outputs to URL:", submitToolOutputsUrl);
                runResponse = await fetch(submitToolOutputsUrl, {
                    method: 'POST',
                    headers: {
                        'api-key': AZURE_OPENAI_API_KEY,
                        'Content-Type': 'application/json',
                        'OpenAI-Beta': 'assistants=v2'
                    },
                    body: JSON.stringify({ tool_outputs: toolOutputs })
                });

                if (!runResponse.ok) {
                    const errorBody = await runResponse.json();
                    throw new Error(`Failed to submit tool outputs: ${runResponse.status} ${runResponse.statusText} - ${errorBody.message || JSON.stringify(errorBody)}`);
                }
                run = await runResponse.json();
                console.log('Tool outputs submitted. Run status after submission:', run.status);
            }
        }

        if (run.status === 'failed') {
            console.error('Assistant run failed:', run.last_error);
            return res.status(500).json({
                error: 'Assistant processing failed.',
                details: run.last_error ? run.last_error.message : 'Unknown failure',
                code: run.last_error ? run.last_error.code : 'UNKNOWN_FAILURE'
            });
        }

        // 4. Retrieve messages from the thread
        const listMessagesUrl = `${OPENAI_API_BASE_URL}/threads/${run.thread_id}/messages?api-version=${AZURE_OPENAI_API_VERSION}`;
        console.log("Retrieving messages from URL:", listMessagesUrl);

        const messagesResponse = await fetch(listMessagesUrl, {
            method: 'GET',
            headers: {
                'api-key': AZURE_OPENAI_API_KEY,
                'OpenAI-Beta': 'assistants=v2'
            }
        });

        if (!messagesResponse.ok) {
            const errorBody = await messagesResponse.json();
            throw new Error(`Failed to retrieve messages: ${messagesResponse.status} ${messagesResponse.statusText} - ${errorBody.message || JSON.stringify(errorBody)}`);
        }
        const messagesData = await messagesResponse.json();
        console.log(`Retrieved ${messagesData.data.length} messages from thread.`);

        // 5. Find the latest assistant message from this run
        const latestAssistantMessage = messagesData.data.find(
            msg => msg.role === 'assistant' && msg.run_id === run.id && msg.content[0].type === 'text'
        );

        if (latestAssistantMessage) {
            console.log("Assistant response found:", latestAssistantMessage.content[0].text.value);
            res.status(200).json({ response: latestAssistantMessage.content[0].text.value });
        } else {
            console.warn("No relevant assistant response found for this run or assistant is still processing.");
            res.status(200).json({ response: 'No response found from assistant for this request (it might still be processing or generated non-text output).' });
        }

    } catch (error) {
        console.error('Error interacting with assistant:', error.message);
        console.error('Full error object:', error);
        res.status(500).json({
            error: 'Failed to get assistant response',
            details: error.message,
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
});

// --- Error Handling Middleware ---
app.use(function (err, req, res, next) {
    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'Unauthorized',
            details: 'Invalid or missing token.'
        });
    }
    next(err);
});

// --- Start the server ---
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});