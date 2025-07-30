// server.js
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { auth } = require('express-oauth2-jwt-bearer');

const mongoose = require('mongoose');
const User = require('./models/User');

// <-- NEW: Import Stripe library
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

// <-- NEW: Import the Fetch API polyfill if needed for older Node versions
// For modern Node (18+), fetch is built-in.
// const fetch = require('node-fetch');

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

// --- Database Connection ---
const DB_URI = process.env.MONGODB_URI;
if (!DB_URI) {
    console.error("ERROR: MONGODB_URI environment variable not set. Cannot connect to database.");
    process.exit(1);
}

mongoose.connect(DB_URI)
    .then(() => console.log('MongoDB connected successfully!'))
    .catch(err => {
        console.error('MongoDB connection error:', err);
        process.exit(1);
    });
// --- END Database Connection ---

// --- CORS Configuration ---
const allowedOrigins = [
    'http://localhost:5173',
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

// --- NEW: Stripe Webhook Route (MUST come before express.json() if you use it globally) ---
// We use express.raw to get the raw body, which is required for Stripe's signature verification.
app.post('/api/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
    const sig = req.headers['stripe-signature'];
    let event;

    try {
        event = stripe.webhooks.constructEvent(
            req.body,
            sig,
            process.env.STRIPE_WEBHOOK_SECRET
        );
    } catch (err) {
        console.error(`⚠️  Webhook Error: ${err.message}`);
        return res.status(400).send(`Webhook Error: ${err.message}`);
    }

    // Handle the event
    switch (event.type) {
        case 'customer.subscription.created':
        case 'customer.subscription.updated':
            const subscription = event.data.object;
            console.log(`Subscription ${subscription.id} status is now ${subscription.status}`);
            try {
                const customerId = subscription.customer;
                const user = await User.findOne({ stripeCustomerId: customerId });

                if (user) {
                    let planStatus = 'expired';
                    let trialEndsAt = null;

                    if (subscription.status === 'active') {
                        planStatus = 'premium';
                    } else if (subscription.status === 'trialing') {
                        planStatus = 'trial';
                        trialEndsAt = new Date(subscription.trial_end * 1000);
                    } else if (subscription.status === 'past_due' || subscription.status === 'canceled' || subscription.status === 'unpaid') {
                        planStatus = 'expired';
                    }

                    user.planStatus = planStatus;
                    user.stripeSubscriptionId = subscription.id;
                    user.trialEndsAt = trialEndsAt;
                    await user.save();
                    console.log(`User ${user.auth0Id} plan updated to ${user.planStatus} via webhook.`);
                } else {
                    console.warn(`User not found for Stripe customer ID ${customerId}.`);
                }
            } catch (err) {
                console.error('Error updating user on subscription webhook:', err);
            }
            break;

        case 'customer.subscription.deleted':
            const deletedSubscription = event.data.object;
            console.log(`Subscription ${deletedSubscription.id} was deleted.`);
            try {
                const customerId = deletedSubscription.customer;
                const user = await User.findOne({ stripeCustomerId: customerId });

                if (user) {
                    user.planStatus = 'expired'; // Or 'free' depending on your business logic
                    user.stripeSubscriptionId = null;
                    user.trialEndsAt = null;
                    await user.save();
                    console.log(`User ${user.auth0Id} plan set to expired after subscription deletion.`);
                }
            } catch (err) {
                console.error('Error updating user on subscription deleted webhook:', err);
            }
            break;

        case 'invoice.paid':
            const invoice = event.data.object;
            console.log(`Invoice ${invoice.id} for customer ${invoice.customer} was paid.`);
            // You can add logic here to handle successful payment events.
            // For subscription-based billing, the 'customer.subscription.updated'
            // event often suffices, but this can be a good secondary check.
            break;

        case 'invoice.payment_failed':
            const failedInvoice = event.data.object;
            console.log(`Invoice ${failedInvoice.id} for customer ${failedInvoice.customer} payment failed.`);
            try {
                const user = await User.findOne({ stripeCustomerId: failedInvoice.customer });
                if (user) {
                    user.planStatus = 'expired'; // Or some other 'past_due' state
                    await user.save();
                    console.log(`User ${user.auth0Id} plan set to expired due to failed invoice payment.`);
                }
            } catch (err) {
                console.error('Error updating user on failed invoice payment:', err);
            }
            break;

        // Add other event types as needed
        default:
            console.log(`Unhandled event type ${event.type}`);
    }

    res.json({ received: true });
});
// --- END Stripe Webhook Route ---


// --- Express Middleware (json parser) ---
// This middleware is applied AFTER the webhook route to avoid parsing raw body
app.use(express.json());


// --- User Management Middleware ---
const ensureUserExists = async (req, res, next) => {
    const auth0Id = req.auth.payload.sub;
    // <-- NEW: Also get email from the JWT payload
    const email = req.auth.payload.email;
    const name = req.auth.payload.name || req.auth.payload.nickname;

    try {
        let user = await User.findOne({ auth0Id });

        if (!user) {
            console.log(`NEW USER: ${auth0Id}. Creating trial account.`);
            user = new User({
                auth0Id,
                email, // <-- NEW: Save email
                name, // <-- NEW: Save name
                planStatus: 'trial', // Set to trial for new users
                trialEndsAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000) // 7-day trial
            });
            await user.save();
            console.log(`Trial account created for ${auth0Id}, trial ends: ${user.trialEndsAt}`);
        } else {
            console.log(`EXISTING USER: ${auth0Id}, Plan: ${user.planStatus}, Trial ends: ${user.trialEndsAt}`);
            // <-- NEW: Update email and name if they are in the token and not in the DB
            if (!user.email && email) user.email = email;
            if (!user.name && name) user.name = name;
            await user.save(); // Save any updates
        }

        req.userRecord = user;
        next();
    } catch (error) {
        console.error('Error in ensureUserExists middleware:', error);
        res.status(500).json({ error: 'Server error during user lookup/creation' });
    }
};

// --- Plan Check Middleware ---
const checkUserPlan = async (req, res, next) => {
    const user = req.userRecord;

    if (!user) {
        console.error("User record not found in request during plan check.");
        return res.status(500).json({ error: 'User data not available for plan check.' });
    }

    const now = new Date();

    if (user.planStatus === 'trial') {
        if (user.trialEndsAt && now > user.trialEndsAt) {
            console.log(`TRIAL EXPIRED: User ${user.auth0Id}'s trial has expired.`);
            if (user.planStatus !== 'expired') {
                user.planStatus = 'expired';
                await user.save();
            }
            return res.status(403).json({
                error: 'Your trial has expired. Please upgrade to a premium plan.',
                planStatus: 'expired'
            });
        } else {
            next();
        }
    } else if (user.planStatus === 'premium') {
        next();
    } else if (user.planStatus === 'expired') {
        console.log(`ACCESS DENIED: User ${user.auth0Id}'s plan is expired.`);
        return res.status(403).json({
            error: 'Your plan has expired. Please upgrade to a premium plan to continue.',
            planStatus: 'expired'
        });
    } else {
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
    });
});

// <-- NEW: Endpoint to create a Stripe Payment Intent for the checkout form -->
app.post('/api/create-payment-intent', checkJwt, ensureUserExists, async (req, res) => {
    const user = req.userRecord;
    // Assuming you have a hardcoded price for a single product/subscription
    // Or you can send a `priceId` from the frontend and validate it here.
    const YOUR_PRICE_ID = process.env.STRIPE_PREMIUM_PRICE_ID; // Example from .env
    const YOUR_PRODUCT_ID = process.env.STRIPE_PREMIUM_PRODUCT_ID; // Example from .env

    try {
        // Create a Stripe Customer if one doesn't exist
        if (!user.stripeCustomerId) {
            const customer = await stripe.customers.create({
                email: user.email,
                name: user.name,
                metadata: {
                    auth0Id: user.auth0Id,
                },
            });
            user.stripeCustomerId = customer.id;
            await user.save();
        }

        // For a subscription, it's more common to create a Subscription
        // with the customer and price.
        // A Payment Intent is for a one-time payment.
        // Let's create a subscription with a payment method attached on the client side.
        // This is a more robust approach for recurring payments.
        const subscription = await stripe.subscriptions.create({
            customer: user.stripeCustomerId,
            items: [{
                price: YOUR_PRICE_ID,
            }],
            payment_behavior: 'default_incomplete',
            expand: ['latest_invoice.payment_intent'],
        });

        // The Payment Intent's client_secret is needed for the frontend's PaymentElement
        const clientSecret = subscription.latest_invoice.payment_intent.client_secret;
        res.status(200).json({ clientSecret });
    } catch (error) {
        console.error('Error creating Stripe Payment Intent/Subscription:', error);
        res.status(500).json({ error: 'Failed to create payment intent.', details: error.message });
    }
});
// <-- END NEW ENDPOINT -->


// Apply `checkJwt`, `ensureUserExists`, and `checkUserPlan` to protected routes
app.post('/api/new-thread', checkJwt, ensureUserExists, checkUserPlan, async (req, res) => {
    console.log("Received request to /api/new-thread (protected)");
    const userId = req.auth.payload.sub;
    console.log("Authenticated user ID:", userId);

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

    try {
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