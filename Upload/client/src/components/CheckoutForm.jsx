// src/components/CheckoutForm.jsx
import React, { useState } from 'react';
import { useStripe, useElements, CardElement } from '@stripe/react-stripe-js';

function CheckoutForm({ onPaymentSuccess, onPaymentError }) {
  const stripe = useStripe();
  const elements = useElements();
  const [loading, setLoading] = useState(false);
  const [paymentStatus, setPaymentStatus] = useState(null); // 'succeeded', 'processing', 'failed', 'idle'

  const handleSubmit = async (event) => {
    event.preventDefault();
    setLoading(true);
    setPaymentStatus('processing');

    if (!stripe || !elements) {
      // Stripe.js has not yet loaded. Make sure to disable form submission until Stripe.js has loaded.
      setLoading(false);
      return;
    }

    try {
      // Step 1: Create PaymentIntent on your backend
      const response = await fetch(`${import.meta.env.VITE_APP_API_URL}/create-payment-intent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ amount: 5000 }), // Example: 50 USD cents = $50.00
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to create Payment Intent on backend');
      }

      const { clientSecret } = await response.json();

      // Step 2: Confirm the payment on the client
      const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
        payment_method: {
          card: elements.getElement(CardElement),
          billing_details: {
            name: 'Jenny Rosen', // Example: Replace with actual user name
          },
        },
      });

      if (error) {
        setPaymentStatus('failed');
        if (onPaymentError) onPaymentError(error.message);
      } else if (paymentIntent.status === 'succeeded') {
        setPaymentStatus('succeeded');
        if (onPaymentSuccess) onPaymentSuccess(paymentIntent);
      } else {
        setPaymentStatus('failed');
        if (onPaymentError) onPaymentError(`Payment not successful: ${paymentIntent.status}`);
      }
    } catch (err) {
      setPaymentStatus('failed');
      if (onPaymentError) onPaymentError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} style={{ padding: '20px', border: '1px solid #ddd', borderRadius: '8px', marginTop: '20px' }}>
      <div style={{ marginBottom: '15px' }}>
        <label htmlFor="card-element" style={{ display: 'block', marginBottom: '8px', fontWeight: 'bold' }}>
          Card Details
        </label>
        <CardElement
          id="card-element"
          options={{
            style: {
              base: {
                fontSize: '16px',
                color: '#424770',
                '::placeholder': {
                  color: '#aab7c4',
                },
              },
              invalid: {
                color: '#9e2146',
              },
            },
          }}
        />
      </div>
      <button type="submit" disabled={!stripe || loading}
        style={{
          padding: '10px 20px',
          backgroundColor: '#6772e5',
          color: 'white',
          border: 'none',
          borderRadius: '5px',
          cursor: 'pointer',
          opacity: loading ? 0.7 : 1,
        }}>
        {loading ? 'Processing...' : 'Pay 50.00'} {/* Amount should reflect what you send to backend */}
      </button>

      {paymentStatus === 'succeeded' && <div style={{ color: 'green', marginTop: '10px' }}>Payment Successful!</div>}
      {paymentStatus === 'failed' && <div style={{ color: 'red', marginTop: '10px' }}>Payment Failed. Please try again.</div>}
      {paymentStatus === 'processing' && <div style={{ color: '#666', marginTop: '10px' }}>Processing payment...</div>}
    </form>
  );
}

export default CheckoutForm;