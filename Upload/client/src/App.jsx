// App.jsx
import React, { useState, useEffect } from 'react';
import { useAuth0 } from '@auth0/auth0-react';
// --- NEW: Import Elements and loadStripe from Stripe libraries ---
import { Elements } from '@stripe/react-stripe-js';
import { loadStripe } from '@stripe/stripe-js';

// --- Import CheckoutForm ---
import CheckoutForm from './components/CheckoutForm';

const API_BASE_URL = import.meta.env.VITE_APP_API_URL;

// --- NEW: Load Stripe publishable key outside of the component ---
// Make sure you have VITE_STRIPE_PUBLISHABLE_KEY set in your .env.local file
const stripePromise = loadStripe(import.meta.env.VITE_APP_STRIPE_PUBLISHABLE_KEY);

function App() {
  const {
    user,
    isAuthenticated,
    isLoading,
    loginWithRedirect,
    logout,
    getAccessTokenSilently,
  } = useAuth0();

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [chatLoading, setChatLoading] = useState(false);
  const [threadId, setThreadId] = useState(null);
  const [error, setError] = useState(null);

  // --- State for User Plan and Trial Info ---
  const [userPlan, setUserPlan] = useState(null); // 'trial', 'premium', 'expired', or 'loading'/'error'
  const [trialDaysRemaining, setTrialDaysRemaining] = useState(null); // Number of days left, or null

  // --- State to control visibility of the upgrade form ---
  const [showUpgradeForm, setShowUpgradeForm] = useState(false);

  // --- Function to fetch user plan status (moved outside useEffect for reusability) ---
  const fetchUserPlan = async () => {
    if (!isAuthenticated) {
      setUserPlan(null); // Clear plan status if not authenticated
      setTrialDaysRemaining(null);
      return;
    }

    setUserPlan('loading'); // Indicate loading state for plan
    try {
      const accessToken = await getAccessTokenSilently({
        audience: import.meta.env.VITE_AUTH0_AUDIENCE, // Ensure this is set for your Auth0 API audience
      });
      const res = await fetch(`${API_BASE_URL}/api/user-status`, {
        headers: {
          'Authorization': `Bearer ${accessToken}`,
        },
      });

      if (!res.ok) {
        const errorData = await res.json();
        throw new Error(`Failed to fetch user status: ${res.status}, Details: ${errorData.error || 'Unknown error'}`);
      }

      const data = await res.json();
      setUserPlan(data.planStatus);
      console.log('User plan status fetched:', data.planStatus, 'Trial ends:', data.trialEndsAt);

      if (data.planStatus === 'trial' && data.trialEndsAt) {
        const trialEndDate = new Date(data.trialEndsAt);
        const now = new Date();
        const diffTime = trialEndDate.getTime() - now.getTime();
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        setTrialDaysRemaining(diffDays);
        console.log(`Trial days remaining: ${diffDays}`);
      } else {
        setTrialDaysRemaining(null);
      }

    } catch (err) {
      console.error('Error fetching user plan:', err);
      setError(`Could not fetch user plan details: ${err.message}`);
      setUserPlan('error'); // Set error state for the plan
    }
  };

  // --- useEffect to fetch user plan status on mount/auth change ---
  useEffect(() => {
    fetchUserPlan();
  }, [isAuthenticated, getAccessTokenSilently, API_BASE_URL]); // Re-run when auth state changes or token is available

  // Function to create a new thread on component mount (if authenticated and plan allows)
  useEffect(() => {
    const createNewThread = async () => {
      if (!isAuthenticated || threadId || chatLoading || userPlan === null || userPlan === 'error' || userPlan === 'expired' || (userPlan === 'trial' && trialDaysRemaining !== null && trialDaysRemaining <= 0)) {
        console.log("Skipping new thread creation due to current state:", { isAuthenticated, threadId, chatLoading, userPlan, trialDaysRemaining });
        return;
      }
      if (userPlan === 'loading') {
          console.log("User plan still loading, deferring thread creation.");
          return;
      }

      try {
        setChatLoading(true);
        setError(null);
        const accessToken = await getAccessTokenSilently();

        const res = await fetch(`${API_BASE_URL}/api/new-thread`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${accessToken}`,
          },
        });

        if (!res.ok) {
          const errorData = await res.json();
          let errorMessage = `HTTP error! Status: ${res.status}`;
          if (errorData.error) errorMessage += `, Details: ${errorData.error}`;
          if (errorData.planStatus) {
            setUserPlan(errorData.planStatus);
            errorMessage = errorData.error;
          }
          throw new Error(errorMessage);
        }

        const data = await res.json();
        setThreadId(data.threadId);
        console.log('New thread created:', data.threadId);
        setMessages([{ role: 'assistant', content: 'Hello! How can I help you today?' }]);
      } catch (err) {
        console.error('Error creating new thread:', err);
        let displayError = `Failed to start chat: ${err.message}.`;
        if (err.message.includes('403') && (userPlan === 'expired' || (userPlan === 'trial' && trialDaysRemaining !== null && trialDaysRemaining <= 0))) {
            displayError = 'Your trial has expired or access is denied. Please upgrade to continue.';
        } else if (err.message.includes('401')) {
            displayError = 'You are not authorized. Please log in again.';
        }
        setError(displayError);
      } finally {
        setChatLoading(false);
      }
    };

    if (isAuthenticated && !threadId && !chatLoading && userPlan !== null && userPlan !== 'loading' && userPlan !== 'error') {
      createNewThread();
    }
  }, [isAuthenticated, getAccessTokenSilently, threadId, chatLoading, userPlan, trialDaysRemaining, API_BASE_URL]);

  const sendMessage = async () => {
    const isChatDisabled = userPlan === 'expired' || (userPlan === 'trial' && trialDaysRemaining !== null && trialDaysRemaining <= 0);

    if (!input.trim() || !threadId || isChatDisabled) {
      if (isChatDisabled) {
        setError('Your plan does not allow sending messages. Please upgrade.');
      } else if (!threadId) {
        setError('Chat not initialized. Please wait or refresh the page.');
      }
      return;
    }

    const userMessage = { role: 'user', content: input.trim() };
    setMessages(prevMessages => [...prevMessages, userMessage]);
    setInput('');
    setChatLoading(true);
    setError(null);

    try {
      const accessToken = await getAccessTokenSilently();

      const res = await fetch(`${API_BASE_URL}/api/chat`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${accessToken}`,
        },
        body: JSON.stringify({ threadId: threadId, message: userMessage.content }),
      });

      if (!res.ok) {
        const errorData = await res.json();
        let errorMessage = `HTTP error! Status: ${res.status}`;
        if (errorData.error) errorMessage += `, Details: ${errorData.error}`;
        if (errorData.planStatus) {
            setUserPlan(errorData.planStatus);
            errorMessage = errorData.error;
        }
        throw new Error(errorMessage);
      }

      const data = await res.json();
      const aiReply = data.response || 'No response from assistant.';

      setMessages(prevMessages => [
        ...prevMessages,
        { role: 'assistant', content: aiReply },
      ]);

    } catch (err) {
      console.error('Error sending message:', err);
      let displayError = `Failed to get response: ${err.message}`;
      if (err.message.includes('403') && (userPlan === 'expired' || (userPlan === 'trial' && trialDaysRemaining !== null && trialDaysRemaining <= 0))) {
          displayError = 'Your trial has expired or access is denied. Please upgrade to continue.';
      } else if (err.message.includes('401')) {
          displayError = 'You are not authorized. Please log in again.';
      }
      setError(displayError);
      setMessages(prevMessages => [
        ...prevMessages,
        { role: 'assistant', content: 'Sorry, I encountered an error. Please try again.' },
      ]);
    } finally {
      setChatLoading(false);
    }
  };

  // --- Handler for successful payment, updates state and plan ---
  const handlePaymentSuccess = () => {
    console.log('Payment successful!');
    setShowUpgradeForm(false); // Hide the checkout form
    fetchUserPlan(); // Re-fetch user plan status to update UI
    setError(null); // Clear any previous errors
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
          <button onClick={() => logout({ logoutParams: { returnTo: window.location.origin + '/fluffy-octo-memory/' } })} style={{ padding: '10px 20px', backgroundColor: '#dc3545', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
            Log Out
          </button>
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

          {/* --- User Plan Status Display --- */}
          {userPlan === 'loading' && (
            <div style={{ backgroundColor: '#e0e0e0', color: '#333', padding: '10px', borderRadius: '5px', marginBottom: '15px', textAlign: 'center' }}>
              Checking your plan status...
            </div>
          )}

          {userPlan === 'trial' && trialDaysRemaining !== null && trialDaysRemaining > 0 && (
            <div style={{ backgroundColor: '#fff3cd', color: '#856404', border: '1px solid #ffeeba', padding: '10px', borderRadius: '5px', marginBottom: '15px', textAlign: 'center' }}>
              You are on a free trial! **{trialDaysRemaining} day{trialDaysRemaining !== 1 ? 's' : ''} remaining.**{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setShowUpgradeForm(true); }} style={{ color: '#007bff', textDecoration: 'underline' }}>Upgrade now</a>
            </div>
          )}

          {(userPlan === 'expired' || (userPlan === 'trial' && trialDaysRemaining !== null && trialDaysRemaining <= 0)) && (
            <div style={{ backgroundColor: '#f8d7da', color: '#721c24', border: '1px solid #f5c6cb', padding: '10px', borderRadius: '5px', marginBottom: '15px', textAlign: 'center' }}>
              Your trial has expired. Please{' '}
              <a href="#" onClick={(e) => { e.preventDefault(); setShowUpgradeForm(true); }} style={{ color: '#dc3545', textDecoration: 'underline' }}>upgrade to a premium plan</a> to continue.
            </div>
          )}

          {userPlan === 'premium' && (
            <div style={{ backgroundColor: '#d4edda', color: '#155724', border: '1px solid #c3e6cb', padding: '10px', borderRadius: '5px', marginBottom: '15px', textAlign: 'center' }}>
              You are a premium user. Enjoy!
            </div>
          )}

          {userPlan === 'error' && (
            <div style={{ backgroundColor: '#f8d7da', color: '#721c24', border: '1px solid #f5c6cb', padding: '10px', borderRadius: '5px', marginBottom: '15px', textAlign: 'center' }}>
              Failed to load your plan status. Please refresh or contact support.
            </div>
          )}
          {/* --- END User Plan Status Display --- */}

          {/* --- NEW: Render CheckoutForm if showUpgradeForm is true, wrapped in Elements --- */}
          {showUpgradeForm && stripePromise && ( // Only render Elements if stripePromise is loaded
            <div style={{ marginTop: '20px', padding: '20px', border: '1px solid #eee', borderRadius: '8px', backgroundColor: '#fff' }}>
              <h3>Upgrade Your Plan</h3>
              <Elements stripe={stripePromise}>
                <CheckoutForm
                  onPaymentSuccess={handlePaymentSuccess} // Use the new handler
                  onPaymentError={(msg) => {
                    console.error('Payment error from CheckoutForm:', msg);
                    setError(`Payment error: ${msg}`);
                  }}
                  apiBaseUrl={API_BASE_URL} // Pass the API base URL
                />
              </Elements>
              <button onClick={() => setShowUpgradeForm(false)} style={{ marginTop: '10px', padding: '8px 15px', backgroundColor: '#6c757d', color: 'white', border: 'none', borderRadius: '5px', cursor: 'pointer' }}>
                Cancel
              </button>
            </div>
          )}

          {/* Chat UI - conditionally render only if upgrade form is NOT shown */}
          {!showUpgradeForm && (
            <>
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
                  disabled={chatLoading || !threadId || userPlan === 'expired' || (userPlan === 'trial' && trialDaysRemaining !== null && trialDaysRemaining <= 0) || userPlan === 'error' || userPlan === 'loading'}
                  placeholder={
                    userPlan === 'loading'
                      ? "Checking plan status..."
                      : (userPlan === 'expired' || (userPlan === 'trial' && trialDaysRemaining !== null && trialDaysRemaining <= 0))
                        ? "Please upgrade to continue chatting."
                        : (threadId ? "Type your message..." : "Initializing chat...")
                  }
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
                  disabled={chatLoading || !threadId || !input.trim() || userPlan === 'expired' || (userPlan === 'trial' && trialDaysRemaining !== null && trialDaysRemaining <= 0) || userPlan === 'error' || userPlan === 'loading'}
                >
                  Send
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export default App;