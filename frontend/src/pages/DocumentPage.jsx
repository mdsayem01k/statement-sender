import React, { useState } from 'react';
import { PdfViewer } from '../components/PdfViewer/PdfViewer';

export const DocumentPage = () => {
  const [code, setCode] = useState('SDFsKJSDFKASDKDFKJSDJSAHJFDHJFKD');

  return (
    <div style={{ padding: '30px', maxWidth: '1000px', margin: '0 auto', fontFamily: 'sans-serif' }}>
      <h2>Secure Document Access Portal</h2>
      <p>Enter or click an encrypted portfolio link to view the document natively in browser.</p>
      
      <div style={{ marginBottom: '20px', display: 'flex', gap: '10px' }}>
        <input 
          type="text" 
          value={code} 
          onChange={(e) => setCode(e.target.value)}
          placeholder="Enter Encrypted Code"
          style={{ width: '400px', padding: '8px', fontSize: '14px' }}
        />
      </div>

      {code ? (
        <PdfViewer encryptoCode={code} />
      ) : (
        <p style={{ color: 'red' }}>Please enter a valid encrypted code parameter.</p>
      )}
    </div>
  );
};
