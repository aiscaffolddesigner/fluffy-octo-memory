require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { auth, RequiredScopes } = require('express-oauth2-jwt-bearer'); // Import Auth0 middleware

const app = express();
const port = process.env.PORT || 3000; // Render sets process.env.PORT

// --- GLOBAL UNCAUGHT EXCEPTION & UNHANDLED REJECTION HANDLERS ---
// This is critical for catching errors that might crash your server process
// and sending them to the Render logs.
process.on('uncaughtException', (error) => {
    console.error('SERVER CRITICAL ERROR: Unhandled Exception Caught!', error);
    // It's good practice to exit the process after logging a critical error
    // so that Render (or your process manager) can restart it cleanly.
    process.exit(1);
});

process.on('unhandledRejection', (reason, promise) => {
    console.error('SERVER CRITICAL ERROR: Unhandled Promise Rejection at:', promise, 'reason:', reason);
    // It's good practice to exit the process after logging a critical error
    // so that Render (or your process manager) can restart it cleanly.
    process.exit(1);
});
// --- END GLOBAL ERROR HANDLERS ---


// --- CORS Configuration ---
const allowedOrigins = [
    'http://localhost:5173', // For local frontend development
    'https://aiscaffolddesigner.github.io/fluffy-octo-memory/' // Your deployed GitHub Pages frontend URL
];

app.use(cors({
    origin: function (origin, callback) {
        // Allow requests with no origin (like mobile apps, Postman, or curl requests)
        if (!origin) {
            console.log("CORS: Allowing request with null origin."); // Added log
            return callback(null, true);
        }
        // If the origin is in our allowed list, permit it
        if (allowedOrigins.indexOf(origin) !== -1) {
            console.log(`CORS: Allowing request from origin: ${origin}`); // Added log
            callback(null, true);
        } else {
            // Block requests from other origins
            const msg = `The CORS policy for this site does not allow access from the specified Origin: ${origin}`;
            console.error(`CORS Error: ${msg}`); // Added log
            callback(new Error(msg), false);
        }
    }
}));

console.log("CORS configured for origins:", allowedOrigins.join(', ')); // Log what origins are allowed

// --- Express Middleware ---
app.use(express.json());

// --- Auth0 Configuration ---
const AUTH0_ISSUER_BASE_URL = process.env.AUTH0_ISSUER_BASE_URL;
const AUTH0_AUDIENCE = process.env.AUTH0_AUDIENCE;

if (!AUTH0_ISSUER_BASE_URL || !AUTH0_AUDIENCE) {
    console.error("ERROR: Missing Auth0 environment variables.");
    console.error("Please ensure AUTH0_ISSUER_BASE_URL and AUTH0_AUDIENCE are set in your .env file.");
    process.exit(1);
}

// Authorization middleware. When used, the Access Token must
// exist and be verified against the Auth0 JSON Web Key Set.
const checkJwt = auth({
    audience: AUTH0_AUDIENCE,
    issuerBaseURL: AUTH0_ISSUER_BASE_URL,
    tokenSigningAlg: 'RS256' // Must match what you set in Auth0 API settings
});

// Example for requiring specific scopes (permissions)
// const checkScopes = RequiredScopes('read:messages'); // If you had specific scopes defined

// --- Azure OpenAI Configuration Constants ---
const AZURE_OPENAI_API_KEY = process.env.AZURE_OPENAI_API_KEY;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT;
const AZURE_OPENAI_API_VERSION = "2024-05-01-preview";
const AZURE_OPENAI_ASSISTANT_ID = process.env.AZURE_OPENAI_ASSISTANT_ID;

const OPENAI_API_BASE_URL = `${AZURE_OPENAI_ENDPOINT}/openai`;

if (!AZURE_OPENAI_API_KEY || !AZURE_OPENAI_ENDPOINT || !AZURE_OPENAI_ASSISTANT_ID) {
    console.error("ERROR: Missing one or more required environment variables for Azure OpenAI.");
    console.error("Please ensure AZURE_OPENAI_API_KEY, AZURE_OPENAI_ENDPOINT, and AZURE_OPENAI_ASSISTANT_ID are set in your .env file.");
    process.exit(1);
}


// --- API Endpoints ---

// Optional: Basic root endpoint for connectivity testing
app.get('/', (req, res) => {
    res.status(200).send('Backend is running and accessible!');
});

// Protect these routes with Auth0 middleware
// Any request to these routes will now require a valid JWT in the Authorization header.
app.post('/api/new-thread', checkJwt, async (req, res) => {
    console.log("Received request to /api/new-thread (protected)");
    // User information (sub, email, etc.) from the JWT payload will be available at req.auth
    // You can use req.auth.payload.sub to get the user's unique ID from Auth0
    const userId = req.auth.payload.sub;
    console.log("Authenticated user ID:", userId);

    // TODO: Implement credit check logic here using userId
    // If not enough credits, return res.status(403).json({ error: 'Not enough credits' });

    try {
        const threadCreationUrl = `${OPENAI_API_BASE_URL}/threads?api-version=${AZURE_OPENAI_API_VERSION}`;
        console.log("Creating thread at URL:", threadCreationUrl);

        const response = await fetch(threadCreationUrl, {
            method: 'POST',
            headers: {
                'api-key': AZURE_OPENAI_API_KEY,
                'Content-Type': 'application/json'
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
        // e.g., saveThreadToDB(userId, thread.id);

        res.status(200).json({ threadId: thread.id });

    } catch (error) {
        console.error('Error creating thread:', error.message);
        console.error('Error details:', error);
        res.status(500).json({
            error: 'Failed to create thread',
            details: error.message,
            code: error.code || 'UNKNOWN_ERROR'
        });
    }
});

app.post('/api/chat', checkJwt, async (req, res) => {
    const { threadId, message } = req.body;
    console.log(`Received chat request for threadId: ${threadId}, message: "${message}" (protected)`);

    const userId = req.auth.payload.sub;
    console.log("Authenticated user ID:", userId);

    if (!threadId || !message) {
        return res.status(400).json({ error: 'threadId and message are required' });
    }

    // TODO: Implement credit deduction logic here using userId
    // First, verify that `threadId` belongs to `userId` from your database for security.
    // getThreadOwner(threadId) === userId
    // If not, return 403 Forbidden.
    // Then, deduct credits for this message. If not enough, return 403.


    try {
        // 1. Add the user's message to the thread
        const addMessageUrl = `${OPENAI_API_BASE_URL}/threads/${threadId}/messages?api-version=${AZURE_OPENAI_API_VERSION}`;
        console.log("Adding message to URL:", addMessageUrl);

        const messageResponse = await fetch(addMessageUrl, {
            method: 'POST',
            headers: {
                'api-key': AZURE_OPENAI_API_KEY,
                'Content-Type': 'application/json'
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
                'Content-Type': 'application/json'
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
                headers: { 'api-key': AZURE_OPENAI_API_KEY }
            });

            if (!runResponse.ok) {
                const errorBody = await runResponse.json();
                throw new Error(`Failed to retrieve run: ${runResponse.status} ${runResponse.statusText} - ${errorBody.message || JSON.stringify(errorBody)}`);
            }
            run = await runResponse.json();
            console.log(`Run ${run.id} status: ${run.status}`);

            // Handle tool calls if your assistant uses them
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
                        'Content-Type': 'application/json'
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

        // If the run failed, log the error
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
            headers: { 'api-key': AZURE_OPENAI_API_KEY }
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

// --- Error Handling Middleware (Optional, but good practice) ---
app.use(function (err, req, res, next) {
    if (err.name === 'UnauthorizedError') {
        return res.status(401).json({
            error: 'Unauthorized',
            details: 'Invalid or missing token.'
        });
    }
    next(err); // Pass other errors to the default Express error handler
});

// --- Start the server ---
app.listen(port, () => {
    console.log(`Server listening on port ${port}`);
});