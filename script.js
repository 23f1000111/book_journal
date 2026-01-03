import { auth, db, signOut, onAuthStateChanged, collection, addDoc, getDocs, updateDoc, deleteDoc, doc, query, where, orderBy, serverTimestamp } from './firebase-config.js';

// DOM Elements - Journal
const appContainer = document.querySelector('.app-container');
const navLinks = document.querySelectorAll('.nav-links li');
const views = document.querySelectorAll('.view');
const modal = document.getElementById('review-modal');
const form = document.getElementById('review-form');
const addBtn = document.getElementById('add-review-btn'); 
const exportBtn = document.getElementById('export-reviews-btn'); 
const exportPdfBtn = document.getElementById('export-pdf-btn'); // PDF Button
const closeModal = document.querySelector('.close-modal');
const reviewsGrid = document.getElementById('reviews-list'); 
const ratingInput = document.querySelector('.star-rating-input');
const ratingValue = document.getElementById('rating-value');
const coverInput = document.getElementById('book-cover-input'); 
const coverPreview = document.getElementById('book-cover-preview'); 
const reviewIdInput = document.getElementById('review-id');
const modalTitle = document.getElementById('modal-title');

// Wishlist DOM Elements
const wishlistGrid = document.getElementById('wishlist-grid');
const wishlistModal = document.getElementById('wishlist-modal');
const wishlistForm = document.getElementById('wishlist-form');
const addWishlistBtn = document.getElementById('add-wishlist-btn');
const wishlistCoverInput = document.getElementById('wishlist-cover-input');
const wishlistCoverPreview = document.getElementById('wishlist-cover-preview');
const wishlistModalTitle = document.getElementById('wishlist-modal-title');
const wishlistIdInput = document.getElementById('wishlist-id');

// Auth DOM Elements
const logoutBtn = document.getElementById('logout-btn');
const journalHeader = document.querySelector('#journal-view h2');

// State
let currentCoverBase64 = null;
let currentWishlistCoverBase64 = null;
let currentUser = null;
let reviews = [];
let wishlist = [];

// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Wait for Auth to Initialize
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            if (journalHeader) journalHeader.textContent = `${user.displayName || 'My'}'s Reading Log`;
            
            // Allow app to show
            appContainer.classList.remove('hidden');

            await fetchReviews();
            await fetchWishlist();
            setupEventListeners();
            
            // Initial Analytics Update
            if (window.updateAnalytics) window.updateAnalytics();
        } else {
            // Not logged in -> Redirect
            window.location.href = 'login.html';
        }
    });
});


// --- Firestore Methods ---

async function fetchReviews() {
    if (!currentUser) return;
    try {
        const q = query(
            collection(db, `users/${currentUser.uid}/reviews`), 
            orderBy('createdAt', 'desc') 
        );
        
        const querySnapshot = await getDocs(q);
        reviews = [];
        querySnapshot.forEach((doc) => {
            reviews.push({ id: doc.id, ...doc.data() });
        });
        renderReviews();
    } catch (e) {
        console.error("Error fetching reviews:", e);
        if (e.code === 'failed-precondition') {
             console.log("Likely missing index. Fetching without sort.");
             const q2 = collection(db, `users/${currentUser.uid}/reviews`);
             const querySnapshot2 = await getDocs(q2);
             reviews = [];
             querySnapshot2.forEach((doc) => {
                reviews.push({ id: doc.id, ...doc.data() });
             });
             reviews.sort((a,b) => (b.createdAt?.seconds || 0) - (a.createdAt?.seconds || 0));
             renderReviews();
         }
    }
}

async function fetchWishlist() {
    if (!currentUser) return;
    try {
        const q = query(collection(db, `users/${currentUser.uid}/wishlist`), orderBy('createdAt', 'desc'));
        const querySnapshot = await getDocs(q);
        wishlist = [];
        querySnapshot.forEach((doc) => {
            wishlist.push({ id: doc.id, ...doc.data() });
        });
        renderWishlist();
    } catch (e) {
        console.error("Error fetching wishlist:", e);
    }
}

async function saveReviewToFire(review) {
    if (!currentUser) {
        alert("You must be logged in to save.");
        return;
    }
    
    const reviewId = review.id;
    delete review.id; 
    
    try {
        if (reviewId) {
            // Update
             await updateDoc(doc(db, `users/${currentUser.uid}/reviews`, reviewId), review);
             alert("Review updated successfully!");
        } else {
            // Create
            review.createdAt = serverTimestamp(); 
            review.userId = currentUser.uid;
            await addDoc(collection(db, `users/${currentUser.uid}/reviews`), review);
            alert("Review saved successfully!");
        }
        await fetchReviews();
    } catch (e) {
        console.error("Error saving review:", e);
        let msg = "Failed to save review.";
        if (e.code === 'permission-denied') msg = "Permission Denied: Please check your Firestore Security Rules (Enable Test Mode).";
        else if (e.code === 'resource-exhausted') msg = "Storage Full or Document too large (Image might be too big).";
        alert(msg + "\n\nError: " + e.message);
    }
}

async function deleteReview(id) {
    if (!currentUser || !confirm("Are you sure you want to delete this review? This cannot be undone.")) return;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/reviews`, id));
        await fetchReviews();
    } catch (e) {
        console.error("Error deleting review:", e);
        alert("Failed to delete review.");
    }
}


async function saveWishlistToFire(item) {
    if (!currentUser) return;
    
    const itemId = item.id;
    delete item.id; 
    
    try {
        if (itemId) {
            // Update
            const docRef = doc(db, `users/${currentUser.uid}/wishlist`, itemId);
            await updateDoc(docRef, item);
            alert("Book updated!");
        } else {
            // Create
            item.createdAt = serverTimestamp();
            await addDoc(collection(db, `users/${currentUser.uid}/wishlist`), item);
            alert("Added to wishlist!");
        }
        await fetchWishlist();
    } catch (e) {
        console.error("Error saving wishlist:", e);
        let msg = "Failed to save book.";
        if (e.code === 'permission-denied') msg = "Permission Denied. Check Firestore Rules.";
        alert(msg);
    }
}

async function deleteWishlistItem(id) {
    if (!currentUser || !confirm("Are you sure you want to remove this book?")) return;
    try {
        await deleteDoc(doc(db, `users/${currentUser.uid}/wishlist`, id));
        await fetchWishlist();
    } catch (e) {
        console.error("Error deleting item:", e);
        alert("Failed to delete item.");
    }
}

// --- Rendering Functions ---

function renderReviews() {
    if (!reviewsGrid) return;
    reviewsGrid.innerHTML = '';
    
    if (reviews.length === 0) {
        reviewsGrid.innerHTML = `
            <div class="empty-state">
                <p>No reviews yet. Start your journal!</p>
            </div>`;
        if(window.updateAnalytics) window.updateAnalytics();
        return;
    }

    reviews.forEach(review => {
        const card = document.createElement('div');
        card.className = 'review-card';
        // Basic Card Template
        let starHtml = '';
        for(let i=1; i<=5; i++) {
            if(review.rating >= i) starHtml += '<i class="fa-solid fa-star"></i>';
            else if(review.rating >= i-0.5) starHtml += '<i class="fa-solid fa-star-half-stroke"></i>';
            else starHtml += '<i class="fa-regular fa-star"></i>';
        }

        const coverSrc = review.cover || 'https://via.placeholder.com/150x220?text=No+Cover';
        
        card.innerHTML = `
            <div class="card-cover">
                <img src="${coverSrc}" alt="${review.title}">
            </div>
            <div class="card-content">
                <div class="card-header">
                    <h3>${review.title}</h3>
                    <div class="header-actions">
                        <span class="genre-tag">${review.genre}</span>
                    </div>
                </div>
                <p class="author">by ${review.author}</p>
                <div class="rating-display">${starHtml}</div>
                <div class="dates">
                    <span>${formatDate(review.startDate)} - ${formatDate(review.endDate)}</span>
                </div>
                ${review.quote ? `<blockquote class="quote">"${review.quote}"</blockquote>` : ''}
                <p class="review-text">${review.review}</p>
                
                <div class="card-footer-actions">
                     <button class="btn-icon print-review-btn" data-id="${review.id}" title="Print">
                        <i class="fa-solid fa-print"></i>
                    </button>
                    <button class="btn-icon edit-review-btn" data-id="${review.id}" title="Edit">
                        <i class="fa-solid fa-pen"></i>
                    </button>
                    <button class="btn-icon delete-review-btn" data-id="${review.id}" title="Delete">
                        <i class="fa-solid fa-trash"></i>
                    </button>
                </div>
            </div>
        `;
        reviewsGrid.appendChild(card);
    });
    
    // Attach Listeners for Review Actions
    document.querySelectorAll('.delete-review-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            deleteReview(id);
        });
    });

    document.querySelectorAll('.edit-review-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const review = reviews.find(r => r.id === id);
            openReviewModal(review);
        });
    });

    document.querySelectorAll('.print-review-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const review = reviews.find(r => r.id === id);
            printReview(review);
        });
    });

    if(window.updateAnalytics) window.updateAnalytics();
}

function renderWishlist() {
    if (!wishlistGrid) return;
    wishlistGrid.innerHTML = '';
    
    if (wishlist.length === 0) {
        wishlistGrid.innerHTML = '<p class="empty-text">Your wishlist is empty.</p>';
        return;
    }

    wishlist.forEach(item => {
        const card = document.createElement('div');
        card.className = 'wishlist-card';
        const coverSrc = item.cover || 'https://via.placeholder.com/150x220?text=Book';
        
        card.innerHTML = `
            <img src="${coverSrc}" alt="${item.title}" class="wishlist-cover">
            <div class="wishlist-info">
                <h4>${item.title}</h4>
                <p>${item.author}</p>
                ${item.link ? `<a href="${item.link}" target="_blank" class="btn-text" style="padding-left:0; text-align:left;">View Book</a>` : ''}
            </div>
            <div class="wishlist-actions">
                <button class="wishlist-btn edit-btn" data-id="${item.id}">
                    <i class="fa-solid fa-pen"></i> Edit
                </button>
                <button class="wishlist-btn delete delete-btn" data-id="${item.id}">
                    <i class="fa-solid fa-trash"></i> Delete
                </button>
            </div>
        `;
        wishlistGrid.appendChild(card);
    });

    // Attach Listeners
    document.querySelectorAll('.delete-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.closest('button').dataset.id;
            deleteWishlistItem(id);
        });
    });

    document.querySelectorAll('.edit-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.target.closest('button').dataset.id;
            const item = wishlist.find(w => w.id === id);
            openWishlistModal(item);
        });
    });
}

// --- Helper Functions ---
function formatDate(dateVal) {
    if (!dateVal) return '';
    if (typeof dateVal === 'object' && dateVal.toDate) {
         return dateVal.toDate().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    }
    return new Date(dateVal).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

function handleImageUpload(e) {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 800 * 1024) { // 800KB Limit
            alert("Image is too large! Please choose an image under 800KB to save database space.");
            e.target.value = ''; // Clear input
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            currentCoverBase64 = e.target.result;
            if(coverPreview && coverPreview.tagName === 'IMG') {
                coverPreview.src = currentCoverBase64;
                coverPreview.classList.remove('hidden');
                const placeholder = coverPreview.parentElement.querySelector('.upload-placeholder');
                if(placeholder) placeholder.classList.add('hidden');
            } else if (coverPreview) {
                coverPreview.innerHTML = `<img src="${currentCoverBase64}" style="width:100%; height:100%; object-fit:cover;">`;
            }
        };
        reader.readAsDataURL(file);
    }
}

function handleWishlistImageUpload(e) {
    const file = e.target.files[0];
    if (file) {
        if (file.size > 800 * 1024) { 
            alert("Image is too large! Please choose an image under 800KB.");
            e.target.value = '';
            return;
        }
        const reader = new FileReader();
        reader.onload = (e) => {
            currentWishlistCoverBase64 = e.target.result;
            const img = document.createElement('img');
            img.src = currentWishlistCoverBase64;
            img.style.width = '100%'; 
            img.style.height = '100%'; 
            img.style.objectFit = 'cover'; 
            
            if(wishlistCoverPreview) {
                wishlistCoverPreview.innerHTML = '';
                wishlistCoverPreview.appendChild(img);
                wishlistCoverPreview.classList.remove('hidden');
                const placeholder = wishlistCoverPreview.parentElement.querySelector('.upload-placeholder');
                if(placeholder) placeholder.classList.add('hidden');
            }
        };
        reader.readAsDataURL(file);
    }
}

function openReviewModal(review = null) {
    modal.classList.remove('hidden');
    form.reset();
    
    if (review) {
        // Edit Mode
        if (modalTitle) modalTitle.innerText = "Edit Review";
        if (reviewIdInput) reviewIdInput.value = review.id;
        
        document.getElementById('title').value = review.title;
        document.getElementById('author').value = review.author;
        document.getElementById('genre').value = review.genre;
        document.getElementById('start-date').value = review.startDate;
        document.getElementById('end-date').value = review.endDate;
        document.getElementById('quote').value = review.quote;
        document.getElementById('review-text').value = review.review;
        
        ratingValue.value = review.rating;
        // Update Stars UI
        const stars = ratingInput.querySelectorAll('i');
        stars.forEach(s => {
            const sVal = parseInt(s.getAttribute('data-value'));
            s.className = '';
            if (review.rating >= sVal) s.className = 'fa-solid fa-star active';
            else if (review.rating >= sVal - 0.5) s.className = 'fa-solid fa-star-half-stroke active';
            else s.className = 'fa-regular fa-star';
        });

        currentCoverBase64 = review.cover;
        if (review.cover) {
             if(coverPreview && coverPreview.tagName === 'IMG') {
                coverPreview.src = review.cover;
                coverPreview.classList.remove('hidden');
                const placeholder = coverPreview.parentElement.querySelector('.upload-placeholder');
                if(placeholder) placeholder.classList.add('hidden');
             } else if(coverPreview) {
                 coverPreview.innerHTML = `<img src="${review.cover}" style="width:100%; height:100%; object-fit:cover;">`;
             }
        } else {
            resetReviewPreview();
        }

    } else {
        // Add Mode
        if (modalTitle) modalTitle.innerText = "Add Book Review";
        if (reviewIdInput) reviewIdInput.value = '';
        currentCoverBase64 = null;
        ratingValue.value = 0;
        document.querySelectorAll('.star-rating-input i').forEach(i => i.className = 'fa-regular fa-star');
        resetReviewPreview();
    }
}

function resetReviewPreview() {
    if(coverPreview) {
        if(coverPreview.tagName === 'IMG') {
            coverPreview.src = '';
            coverPreview.classList.add('hidden');
        } else {
            coverPreview.innerHTML = '';
        }
        const placeholder = coverPreview.parentElement.querySelector('.upload-placeholder');
        if(placeholder) placeholder.classList.remove('hidden');
    }
}

function openWishlistModal(item = null) {
    wishlistModal.classList.remove('hidden');
    wishlistForm.reset();
    
    if (item) {
        // Edit Mode
        if (wishlistModalTitle) wishlistModalTitle.innerText = "Edit Book";
        if (wishlistIdInput) wishlistIdInput.value = item.id;
        document.getElementById('wishlist-title').value = item.title;
        document.getElementById('wishlist-author').value = item.author;
        document.getElementById('wishlist-link').value = item.link || '';
        
        currentWishlistCoverBase64 = item.cover;
        if (item.cover) {
             const img = document.createElement('img');
            img.src = item.cover;
            img.style.width = '100%'; 
            img.style.height = '100%'; 
            img.style.objectFit = 'cover'; 
            
            if(wishlistCoverPreview) {
                wishlistCoverPreview.innerHTML = '';
                wishlistCoverPreview.appendChild(img);
                wishlistCoverPreview.classList.remove('hidden');
                const placeholder = wishlistCoverPreview.parentElement.querySelector('.upload-placeholder');
                if(placeholder) placeholder.classList.add('hidden');
            }
        } else {
            resetWishlistPreview();
        }

    } else {
        // Add Mode
        if (wishlistModalTitle) wishlistModalTitle.innerText = "Add to Wishlist";
        if (wishlistIdInput) wishlistIdInput.value = '';
        currentWishlistCoverBase64 = null;
        resetWishlistPreview();
    }
}

function resetWishlistPreview() {
    if(wishlistCoverPreview) {
        wishlistCoverPreview.innerHTML = '';
        wishlistCoverPreview.classList.add('hidden');
        const placeholder = wishlistCoverPreview.parentElement.querySelector('.upload-placeholder');
        if(placeholder) placeholder.classList.remove('hidden');
    }
}

function printReview(review) {
    const printWindow = window.open('', '_blank');
    const starHtml = '★'.repeat(Math.round(review.rating)) + '☆'.repeat(5 - Math.round(review.rating));
    
    printWindow.document.write(`
        <html>
        <head>
            <title>Review: ${review.title}</title>
            <style>
                body { font-family: 'Georgia', serif; padding: 40px; }
                h1 { font-family: 'Arial', sans-serif; margin-bottom: 5px; }
                .meta { color: #666; font-style: italic; margin-bottom: 20px; }
                .cover { max-width: 200px; float: left; margin-right: 20px; margin-bottom: 20px; border: 1px solid #ccc; }
                .content { line-height: 1.6; }
                .quote { border-left: 3px solid #ccc; padding-left: 15px; margin: 20px 0; font-style: italic; font-size: 1.1em; }
                .rating { color: gold; font-size: 1.2em; }
            </style>
        </head>
        <body>
            ${review.cover ? `<img src="${review.cover}" class="cover">` : ''}
            <h1>${review.title}</h1>
            <p class="meta">by ${review.author} | read: ${review.endDate}</p>
            <div class="rating">${starHtml}</div>
            
            ${review.quote ? `<div class="quote">"${review.quote}"</div>` : ''}
            
            <div class="content">
                ${review.review.replace(/\n/g, '<br>')}
            </div>
            
            <script>
                window.onload = function() { window.print(); }
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function exportReviews() {
    if (!reviews.length) {
        alert("No reviews to export.");
        return;
    }
    
    // Convert to CSV
    const headers = ["Title", "Author", "Genre", "Rating", "Started", "Finished", "Quote", "Review"];
    const csvRows = [headers.join(',')];
    
    reviews.forEach(r => {
        const row = [
            `"${r.title || ''}"`,
            `"${r.author || ''}"`,
            `"${r.genre || ''}"`,
            r.rating || 0,
            r.startDate || '',
            r.endDate || '',
            `"${(r.quote || '').replace(/"/g, '""')}"`, // Escape quotes
            `"${(r.review || '').replace(/"/g, '""').replace(/\n/g, ' ')}"`
        ];
        csvRows.push(row.join(','));
    });
    
    const csvString = csvRows.join('\n');
    const blob = new Blob([csvString], { type: 'text/csv' });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.setAttribute('hidden', '');
    a.setAttribute('href', url);
    a.setAttribute('download', `reading_journal_export_${new Date().toISOString().slice(0,10)}.csv`);
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
}

function exportReviewsToPDF() {
    if (!reviews.length) {
        alert("No reviews to export.");
        return;
    }
    
    const element = document.getElementById('reviews-list');
    
    // Options for PDF
    const opt = {
        margin: [10, 10, 10, 10],
        filename: `reading_journal_${new Date().toISOString().slice(0,10)}.pdf`,
        image: { type: 'jpeg', quality: 0.98 },
        html2canvas: { scale: 2, useCORS: true, letterRendering: true },
        jsPDF: { unit: 'mm', format: 'a4', orientation: 'portrait' },
        pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
    };
    
    // Add temporary class for styling during export
    element.classList.add('pdf-export-mode');
    
    html2pdf().set(opt).from(element).save()
        .then(() => {
            element.classList.remove('pdf-export-mode');
        })
        .catch(err => {
            console.error(err);
            element.classList.remove('pdf-export-mode');
            alert("PDF generation failed. Check console.");
        });
}


// --- Event Listeners ---
function setupEventListeners() {
    // Navigation
    navLinks.forEach(link => {
        link.addEventListener('click', () => {
            navLinks.forEach(l => l.classList.remove('active'));
            link.classList.add('active');
            const tab = link.getAttribute('data-tab');
            views.forEach(view => {
                view.classList.add('hidden');
                if (view.id === `${tab}-view`) view.classList.remove('hidden');
            });
        });
    });

    // Logout
    if(logoutBtn) {
        logoutBtn.addEventListener('click', async () => {
            await signOut(auth);
            window.location.href = 'login.html';
        });
    }

    // Modal
    if(addBtn) addBtn.addEventListener('click', () => {
        openReviewModal(); 
    });
    
    // Export CSV
    if(exportBtn) {
        exportBtn.addEventListener('click', exportReviews);
    }
    
    // Export PDF
    if(exportPdfBtn) {
        exportPdfBtn.addEventListener('click', exportReviewsToPDF);
    }

    if(closeModal) closeModal.addEventListener('click', () => modal.classList.add('hidden'));

    // Rating (UI Only)
    if(ratingInput) {
        ratingInput.addEventListener('click', (e) => {
            const star = e.target.closest('i');
            if (!star) return;
            const value = parseInt(star.getAttribute('data-value'));
            const rect = star.getBoundingClientRect();
            const x = e.clientX - rect.left;
            const width = rect.width;
            let finalRating = value;
            if (x < width / 2) finalRating = value - 0.5;
            
            ratingValue.value = finalRating;
            
            // Visual Update
            const stars = ratingInput.querySelectorAll('i');
            stars.forEach(s => {
                const sVal = parseInt(s.getAttribute('data-value'));
                s.className = '';
                if (finalRating >= sVal) s.className = 'fa-solid fa-star active';
                else if (finalRating >= sVal - 0.5) s.className = 'fa-solid fa-star-half-stroke active';
                else s.className = 'fa-regular fa-star';
            });
        });
    }

    // Form Submit
    if(form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('review-id').value;
            const review = {
                id: id || null,
                title: document.getElementById('title').value,
                author: document.getElementById('author').value,
                genre: document.getElementById('genre').value,
                startDate: document.getElementById('start-date').value,
                endDate: document.getElementById('end-date').value,
                rating: parseFloat(document.getElementById('rating-value').value),
                quote: document.getElementById('quote').value,
                review: document.getElementById('review-text').value,
                cover: currentCoverBase64
            };
            
            await saveReviewToFire(review);
            modal.classList.add('hidden');
        });
    }

    // Image Upload
    if(coverInput) coverInput.addEventListener('change', handleImageUpload);

    // Wishlist Modal
    if(addWishlistBtn) addWishlistBtn.addEventListener('click', () => {
        openWishlistModal();
    });
    
    // Close Wishlist Modal
    document.querySelectorAll('.close-modal').forEach(btn => {
        btn.addEventListener('click', () => {
            if(wishlistModal) wishlistModal.classList.add('hidden');
            if(modal) modal.classList.add('hidden');
        });
    });

    if(wishlistForm) {
        wishlistForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const id = document.getElementById('wishlist-id').value;
            const item = {
                id: id || null,
                title: document.getElementById('wishlist-title').value,
                author: document.getElementById('wishlist-author').value,
                link: document.getElementById('wishlist-link').value,
                cover: currentWishlistCoverBase64
            };
            await saveWishlistToFire(item);
            wishlistModal.classList.add('hidden');
        });
    }
    
    if(wishlistCoverInput) wishlistCoverInput.addEventListener('change', handleWishlistImageUpload);
}

// Expose for Analytics
window.getReviews = () => reviews;
window.reviewManager = {
    getAllReviews: () => reviews
};
