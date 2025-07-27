import React, { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react'; // Import useAuth0 hook

function App() {
  const {
    user, // Contains user profile information
    isAuthenticated, // True if the user is logged in
    isLoading, // True while Auth0 is loading user state
    loginWithRedirect, // Function to trigger login
    logout, // Function to trigger logout
    getAccessTokenSilently, // Function to get Access Token for your API
  } = useAuth0();

  // console.log('Auth0 State - isLoading:', isLoading, 'isAuthenticated:', isAuthenticated); // Uncomment for debugging

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false); // Renamed to avoid conflict with Auth0 isLoading
  const [threadId, setThreadId] = useState(null);
  const [error, setError] = useState(null);

  // Function to create a new thread on component mount (if authenticated)
  useEffect(() => {
    const createNewThread = async () => {
      // It's good practice to have this guard here,
      // but the main trigger is the `if (isAuthenticated ...)`
      // right below this function definition in the useEffect callback.
      if (!isAuthenticated) return;

      try {
        setChatLoading(true);
        setError(null);
        // Get Access Token to send to your protected backend
        const accessToken = await getAccessTokenSilently({
          // You can specify an audience here, but it's already set globally in Auth0Provider
          // audience: import.meta.env.VITE_AUTH0_AUDIENCE,
        });

        const res = await fetch('http://localhost:3000/api/new-thread', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`, // Send the Access Token
          },
        });

        if (!res.ok) {
          const errorData = await res.json();
          throw new Error(`HTTP error! Status: ${res.status}, Details: ${errorData.error || 'Unknown error'}`);
        }

        const data = await res.json();
        setThreadId(data.threadId);
        console.log('New thread created:', data.threadId);
        setMessages([{ role: 'assistant', content: 'Hello! How can I help you today?' }]);
      } catch (err) {
        console.error('Error creating new thread:', err);
        setError(`Failed to start chat: ${err.message}. Please check your backend server and ensure you are logged in.`);
        // If error is 401/403, might need to prompt re-login or show specific message
        if (err.message.includes('401') || err.message.includes('403')) {
            setError('You are not authorized to start a chat. Please log in or check your permissions/credits.');
        }
      } finally {
        setChatLoading(false);
      }
    };

    // Only create thread if authenticated, not already initialized, and not currently loading a new thread
    if (isAuthenticated && !threadId && !chatLoading) {
      createNewThread();
    }
  }, [isAuthenticated, getAccessTokenSilently, threadId, chatLoading]); // Depend on isAuthenticated and other states

  const sendMessage = async () => {
    if (!input.trim() || !threadId) {
      if (!threadId) {
        setError('Chat not initialized. Please wait or refresh the page.');
      }
      return;
    }

    const userMessage = { role: 'user', content: input.trim() };
    setMessages(prevMessages => [...prevMessages, userMessage]);
    setInput('');
    setChatLoading(true); // Use chatLoading
    setError(null);

    try {
        // Get Access Token to send to your protected backend
        const accessToken = await getAccessTokenSilently();

      const res = await fetch('http://localhost:3000/api/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`, // Send the Access Token
        },
        body: JSON.stringify({ threadId: threadId, message: userMessage.content }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(`HTTP error! Status: ${res.status}, Details: ${errorData.error || 'Unknown error'}`);
      }

      const data = await res.json();
      const aiReply = data.response || 'No response from assistant.';

      setMessages(prevMessages => [
        ...prevMessages,
        { role: 'assistant', content: aiReply },
      ]);

    } catch (err) {
      console.error('Error sending message:', err);
      setError(`Failed to get response: ${err.message}`);
      setMessages(prevMessages => [
        ...prevMessages,
        { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' },
      ]);
      // Handle 401/403 specific errors
      if (err.message.includes('401') || err.message.includes('403')) {
          setError('You are not authorized to send messages. Please log in or check your permissions/credits.');
      }
    } finally {
      setChatLoading(false); // Use chatLoading
    }
  };

  // --- Render based on Auth0 loading state ---
  if (isLoading) {
    return <div style={{ textAlign: 'center', padding: '50px' }}>Loading authentication...</div>;
  }

  return (
    <div style={{ maxWidth: 600, margin: 'auto', padding: 20, fontFamily: 'Arial, sans-serif', backgroundColor: '#f9f9f9', borderRadius: '8px', boxShadow: '0 2px 10px rgba(0,0,0,0.1)' }}>
      <h1 style={{ textAlign: 'center', color: '#333' }}>AIScaffoldDesigner Chat</h1>

      {/* Auth0 Login/Logout Buttons */}
      {!isAuthenticated ? (
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <p>Please log in to start chatting.</p>
          <button onClick={() => loginWithRedirect()} style={{ padding: '10px 20px', backgroundColor: '#28a745', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
            Log In
          </button>
        </div>
      ) : (
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <p>Welcome, {user.name || user.email}!</p>
          <button onClick={() => logout({ logoutParams: { returnTo: window.location.origin } })} style={{ padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
            Log Out
          </button>
          {/* Optionally display user's credits here (requires fetching from backend) */}
        </div>
      )}

      {/* Display chat UI only if authenticated */}
      {isAuthenticated && (
        <>
          {error && (
            <div style={{ color: 'white', backgroundColor: '#dc3545', padding: '10px', borderRadius: '5px', marginBottom: '15px' }}>
              <strong>Error:</strong> {error}
            </div>
          )}

          <div style={{ border: '1px solid #eee', padding: 15, minHeight: 350, maxHeight: 500, overflowY: 'auto', marginBottom: 15, borderRadius: '8px', backgroundColor: '#fff' }}>
            {messages.length === 0 && !chatLoading && !error && (
              <div style={{ textAlign: 'center', color: '#666', marginTop: '20%' }}>
                {threadId ? 'Type your first message below!' : 'Initializing chat...'}
              </div>
            )}
            {messages.map((msg, idx) => (
              <div
                key={idx}
                style={{
                  display: 'flex',
                  justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                  marginBottom: 10,
                }}
              >
                <div
                  style={{
                    maxWidth: '80%',
                    padding: '10px 15px',
                    borderRadius: '18px',
                    backgroundColor: msg.role === 'user' ? '#007bff' : '#e2e6ea',
                    color: msg.role === 'user' ? 'white' : '#333',
                    wordWrap: 'break-word',
                    whiteSpace: 'pre-wrap',
                    boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
                    borderBottomRightRadius: msg.role === 'user' ? '2px' : '18px',
                    borderBottomLeftRadius: msg.role === 'user' ? '18px' : '2px',
                  }}
                >
                  {msg.content}
                </div>
              </div>
            ))}
            {chatLoading && (
              <div style={{ textAlign: 'center', color: '#666', fontStyle: 'italic' }}>Thinking...</div>
            )}
          </div>

          <div style={{ display: 'flex', gap: '10px' }}>
            <input
              type="text"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && !chatLoading && threadId && sendMessage()}
              style={{
                flexGrow: 1,
                padding: '10px 15px',
                border: '1px solid #ccc',
                borderRadius: '20px',
                fontSize: '16px',
                outline: 'none',
              }}
              disabled={chatLoading || !threadId}
              placeholder={threadId ? "Type your message..." : "Initializing chat..."}
            />
            <button
              onClick={sendMessage}
              style={{
                padding: '10px 20px',
                backgroundColor: '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '20px',
                cursor: 'pointer',
                fontSize: '16px',
                fontWeight: 'bold',
                transition: 'background-color 0.2s',
              }}
              onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#0056b3'}
              onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#007bff'}
              disabled={chatLoading || !threadId || !input.trim()}
            >
              Send
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default App;