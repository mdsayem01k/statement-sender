import React from 'react';
import { buildPdfUrl } from '../../services/documentService';

export const PdfViewer = ({ encryptoCode }) => {
  const pdfUrl = buildPdfUrl(encryptoCode);

  return (
    <div style={{ margin: '20px 0', fontFamily: 'sans-serif' }}>
      <div style={{ marginBottom: '15px' }}>
        <h3>Document Action Options:</h3>
        <a 
          href={pdfUrl} 
          target="_blank" 
          rel="noopener noreferrer"
          style={{
            display: 'inline-block',
            padding: '10px 20px',
            backgroundColor: '#0066cc',
            color: '#fff',
            borderRadius: '4px',
            textDecoration: 'none',
            fontWeight: 'bold',
            marginRight: '10px'
          }}
        >
          Open in New Browser Tab (Native Viewer)
        </a>
      </div>

      <div style={{ marginTop: '20px' }}>
        <h4>Embedded Preview (Browser Native Engine):</h4>
        <iframe 
          src={pdfUrl} 
          title="PDF Document Preview"
          width="100%" 
          height="650px" 
          style={{ border: '1px solid #ccc', borderRadius: '4px' }}
        />
      </div>
    </div>
  );
};
