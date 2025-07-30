// client/src/components/CheckoutForm.jsx
import React, { useState, useEffect } from 'react';
import { useStripe, useElements, PaymentElement } from '@stripe/react-stripe-js';
import { useAuth0 } from '@auth0/auth0-react'; // NEW: Import useAuth0 hook

function CheckoutForm({ onPaymentSuccess, onPaymentError }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(null);
  const [clientSecret, setClientSecret] = useState('');

  // NEW: Destructure getAccessTokenSilently and isAuthenticated from useAuth0
  const { getAccessTokenSilently, isAuthenticated } = useAuth0();

  // Use useEffect to fetch the clientSecret when the component mounts
  useEffect(() => {
    async function fetchClientSecret() {
      setLoading(true);
      try {
        let token;
        // Only attempt to get a token if the user is authenticated
        if (isAuthenticated) {
          try {
            // Get the access token silently from Auth0
            token = await getAccessTokenSilently();
            console.log("Access Token obtained:", token); // Log token for debugging
          } catch (authError) {
            console.error("Error getting access token:", authError);
            // Handle cases where token cannot be retrieved (e.g., user not logged in or session expired)
            setPaymentStatus('failed');
            if (onPaymentError) onPaymentError("Authentication required to process payment.");
            setLoading(false);
            return; // Stop execution if token cannot be obtained
          }
        } else {
          // User is not authenticated, cannot create payment intent
          setPaymentStatus('failed');
          if (onPaymentError) onPaymentError("You must be logged in to upgrade your plan.");
          setLoading(false);
          return; // Stop execution if not authenticated
        }

        const response = await fetch(`${import.meta.env.VITE_APP_API_URL}/create-payment-intent`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${token}` // Use the obtained token here
          },
        });

        if (!response.ok) {
          const errorData = await response.json();
          throw new Error(errorData.error || 'Failed to create Payment Intent/Subscription on backend');
        }

        const data = await response.json();
        setClientSecret(data.clientSecret);
      } catch (err) {
        console.error("Error fetching client secret:", err);
        setPaymentStatus('failed');
        if (onPaymentError) onPaymentError(err.message);
      } finally {
        setLoading(false);
      }
    }

    // Only fetch if Stripe and Elements are loaded, and user is authenticated
    // Adding isAuthenticated and getAccessTokenSilently to dependencies to ensure effect re-runs if auth state changes
    if (stripe && elements && isAuthenticated) {
      fetchClientSecret();
    }
  }, [stripe, elements, isAuthenticated, getAccessTokenSilently, onPaymentError]); // Added dependencies

  const handleSubmit = async (event) => {
    // ... (rest of your handleSubmit function, it remains the same as before) ...
    event.preventDefault();
    setLoading(true);
    setPaymentStatus('processing');

    if (!stripe || !elements || !clientSecret) {
      setLoading(false);
      return;
    }

    try {
      const { error } = await stripe.confirmPayment({
        elements,
        confirmParams: {
          return_url: `${window.location.origin}/payment-success`, // Adjust if your success URL is different
        },
        redirect: 'if_required',
      });

      if (error) {
        setPaymentStatus('failed');
        if (onPaymentError) onPaymentError(error.message);
        setLoading(false);
      } else {
        const { paymentIntent } = await stripe.retrievePaymentIntent(clientSecret);
        if (paymentIntent.status === 'succeeded') {
          setPaymentStatus('succeeded');
          if (onPaymentSuccess) onPaymentSuccess(paymentIntent);
        } else {
          setPaymentStatus('failed');
          if (onPaymentError) onPaymentError(`Payment not successful: ${paymentIntent.status}`);
        }
        setLoading(false);
      }
    } catch (err) {
      setPaymentStatus('failed');
      if (onPaymentError) onPaymentError(err.message);
      setLoading(false);
    }
  };

  return (
    // ... (rest of your JSX, it remains the same as before) ...
    <form onSubmit={handleSubmit} style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', marginTop: '20px' }}>
      <div style={{ marginBottom: '15px' }}>
        <label htmlFor="payment-element" style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          Card Details
        </label>
        {clientSecret ? (
          <PaymentElement id="payment-element" />
        ) : (
          <div style={{ textAlign: 'center', padding: '20px', color: '#666' }}>
            Loading payment form...
          </div>
        )}
      </div>
      <button
        type="submit"
        disabled={!stripe || !elements || !clientSecret || loading}
        style={{
          padding: '10px 20px',
          backgroundColor: '#6772e5',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          opacity: (!stripe || !elements || !clientSecret || loading) ? 0.7 : 1,
        }}
      >
        {loading ? 'Processing...' : 'Subscribe Now'}
      </button>

      {paymentStatus === 'succeeded' && <div style={{ color: 'green', marginTop: '10px' }}>Subscription Successful!</div>}
      {paymentStatus === 'failed' && <div style={{ color: 'red', marginTop: '10px' }}>Payment Failed. Please try again.</div>}
      {paymentStatus === 'processing' && <div style={{ color: '#666', marginTop: '10px' }}>Processing payment...</div>}
      {paymentStatus === null && !clientSecret && (
        <div style={{ color: '#666', marginTop: '10px' }}>Waiting for payment form to load...</div>
      )}
    </form>
  );
}

export default CheckoutForm;