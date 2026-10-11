import { getPageItems } from '../utils/pagination';
import './Pagination.css';

export default function Pagination({ page, totalPages, from, to, total, onPageChange }) {
  if (total === 0) return null;

  return (
    <nav className="cls-pagination" aria-label="Pagination">
      <span className="cls-pagination-info">
        Showing <strong>{from}–{to}</strong> of <strong>{total}</strong>
      </span>

      {totalPages > 1 && (
        <div className="cls-pagination-controls">
          <button
            type="button"
            className="cls-page-btn"
            onClick={() => onPageChange(page - 1)}
            disabled={page === 1}
            aria-label="Previous page"
          >
            Prev
          </button>

          {getPageItems(page, totalPages).map((item) =>
            typeof item === 'number' ? (
              <button
                key={item}
                type="button"
                className={`cls-page-btn ${item === page ? 'active' : ''}`}
                onClick={() => onPageChange(item)}
                aria-current={item === page ? 'page' : undefined}
              >
                {item}
              </button>
            ) : (
              <span key={item} className="cls-page-gap" aria-hidden="true">…</span>
            )
          )}

          <button
            type="button"
            className="cls-page-btn"
            onClick={() => onPageChange(page + 1)}
            disabled={page === totalPages}
            aria-label="Next page"
          >
            Next
          </button>
        </div>
      )}
    </nav>
  );
}
