import { auth, db, signOut, onAuthStateChanged, collection, addDoc, getDocs, updateDoc, deleteDoc, setDoc, getDoc, doc, query, where, orderBy, serverTimestamp } from './firebase-config.js';

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
const loadingOverlay = document.getElementById('loading-overlay');

// Wishlist DOM Elements
const wishlistGrid = document.getElementById('wishlist-grid');
const wishlistModal = document.getElementById('wishlist-modal');
const wishlistForm = document.getElementById('wishlist-form');
const addWishlistBtn = document.getElementById('add-wishlist-btn');
const wishlistCoverInput = document.getElementById('wishlist-cover-input');
const wishlistCoverPreview = document.getElementById('wishlist-cover-preview');
const wishlistModalTitle = document.getElementById('wishlist-modal-title');
const wishlistIdInput = document.getElementById('wishlist-id');
const shareWishlistBtn = document.getElementById('share-wishlist-btn');
const printWishlistBtn = document.getElementById('print-wishlist-btn');
const exportWishlistPdfBtn = document.getElementById('export-wishlist-pdf-btn');

// Goals Elements
const editGoalBtn = document.getElementById('edit-goal-btn');
const goalProgressBar = document.getElementById('goal-progress-bar');
const goalText = document.getElementById('goal-text');

// Community / Friend Elements
const addFriendForm = document.getElementById('add-friend-form');
const friendEmailInput = document.getElementById('friend-email-input');
const friendsList = document.getElementById('friends-list');
const friendModal = document.getElementById('friend-modal');
const friendReviewsGrid = document.getElementById('friend-reviews-list');
const friendGoalBar = document.getElementById('friend-goal-bar');
const friendGoalText = document.getElementById('friend-goal-text');
const friendModalTitle = document.getElementById('friend-modal-title');

// Auth DOM Elements
const logoutBtn = document.getElementById('logout-btn');
const journalHeader = document.querySelector('#journal-view h2');

// State
let currentCoverBase64 = null;
let currentWishlistCoverBase64 = null;
let currentUser = null;
let reviews = [];
let wishlist = [];
let yearlyGoals = {}; // Map of year -> goal
let currentYearFilter = new Date().getFullYear();
let friends = [];
let deferredPrompt; // For PWA install

// Search & Sort State
let currentSearchTerm = '';
let currentSortOrder = 'date-desc';


// --- Initialization ---
document.addEventListener('DOMContentLoaded', () => {
    // Wait for Auth to Initialize
    onAuthStateChanged(auth, async (user) => {
        if (user) {
            currentUser = user;
            if (journalHeader) journalHeader.textContent = `${user.displayName || 'My'}'s Reading Log`;
            
            // Allow app to show
            appContainer.classList.remove('hidden');

            // Initialize Search Profile
            await updatePublicProfile(user);

            await fetchReviews();
            await fetchWishlist();
            await fetchUserGoal();
            await fetchFriends();
            await fetchFriends();
            setupEventListeners();
            setupSearchListeners();
            
            // Initial Analytics Update
            if (window.updateAnalytics) window.updateAnalytics();

            // Check for Share Data (Now that we are logged in)
            handleIncomingShare();
        } else {
            // Not logged in -> Redirect
            window.location.href = 'login.html';
        }
    });


    // --- PWA Install Logic ---
    const installBtn = document.getElementById('install-app-btn');
    
    window.addEventListener('beforeinstallprompt', (e) => {
        // Prevent Chrome 67 and earlier from automatically showing the prompt
        e.preventDefault();
        // Stash the event so it can be triggered later.
        deferredPrompt = e;
        // Update UI to notify the user they can add to home screen
        if(installBtn) installBtn.style.display = 'block';
    });

    if(installBtn) {
        installBtn.addEventListener('click', (e) => {
            // Hide our user interface that shows our A2HS button
            installBtn.style.display = 'none';
            // Show the prompt
            if(deferredPrompt) {
                deferredPrompt.prompt();
                // Wait for the user to respond to the prompt
                deferredPrompt.userChoice.then((choiceResult) => {

                    deferredPrompt = null;
                });
            }
        });
    }

    // END: Handle Share Target (Moved to function)
});

async function handleIncomingShare() {
    // START: Handle Share Target (Incoming Data from other apps)
    const urlParams = new URLSearchParams(window.location.search);
    const sharedTitle = urlParams.get('title');
    const sharedText = urlParams.get('text');
    const sharedUrl = urlParams.get('url');

    if (sharedTitle || sharedText || sharedUrl) {


        // 1. Switch to Wishlist View
        // Wait for UI
        await new Promise(r => setTimeout(r, 500)); 
        const wishlistTab = document.querySelector('li[data-tab="wishlist"]');
        if(wishlistTab) wishlistTab.click();

        // 2. Parse Basic Info
        let query = sharedTitle || '';
        let bookLink = sharedUrl || '';
        
        // Extract URL from text if needed
        if (!bookLink && sharedText) {
            const urlRegex = /(https?:\/\/[^\s]+)/g;
            const matches = sharedText.match(urlRegex);
            if (matches) bookLink = matches[0];
        }

        // Clean Text to get a Search Query (Title)
        if (!query && sharedText) {
             let cleanText = sharedText;
             if(bookLink) cleanText = cleanText.replace(bookLink, '');
             // Remove common share garbage
             cleanText = cleanText.replace(/Check out this book:?/i, '');
             cleanText = cleanText.replace(/I found this book on Amazon:?/i, '');
             cleanText = cleanText.trim();
             query = cleanText;
        }

        // 3. Open Modal Immediately (User sees something happening)
        openWishlistModal();
        
        // Set Link immediately
        setTimeout(() => {
             const linkInput = document.getElementById('wishlist-link');
             const titleInput = document.getElementById('wishlist-title');
             if(linkInput && bookLink) linkInput.value = bookLink;
             if(titleInput) {
                 titleInput.value = "Searching book details...";
                 titleInput.disabled = true;
             }
        }, 100);

        // 4. FETCH METADATA (The Magic Fix)
        // Use Google Books API to turn "Title/Text" into real data
        if (query) {
            try {
                const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(query)}`);
                const data = await res.json();
                
                if (data.items && data.items.length > 0) {
                    const book = data.items[0].volumeInfo;
                    
                    // Populate Fields
                     setTimeout(() => {
                        const titleInput = document.getElementById('wishlist-title');
                        const authorInput = document.getElementById('wishlist-author');
                        
                        if(titleInput) {
                             titleInput.value = book.title;
                             titleInput.disabled = false;
                        }
                        if(authorInput && book.authors) authorInput.value = book.authors[0];
                        
                        // Handle Image
                        if (book.imageLinks && book.imageLinks.thumbnail) {
                            // High res if possible
                            let imgUrl = book.imageLinks.thumbnail.replace('http:', 'https:');
                            // Try to get a cleaner image by removing zoom params if present, though google APIs are tricky.
                            // Just use the one provided.
                            
                            // To save it, we might need to fetch it and convert to Blob? 
                            // For now, let's display it. The user might need to save it manually or we convert to Base64.
                            // Let's try to convert to Base64 automatically so it saves to Firebase.
                            fetch(imgUrl)
                                .then(r => r.blob())
                                .then(blob => {
                                    const reader = new FileReader();
                                    reader.onloadend = () => {
                                        currentWishlistCoverBase64 = reader.result;
                                        if(wishlistCoverPreview) {
                                            wishlistCoverPreview.innerHTML = `<img src="${currentWishlistCoverBase64}" style="width:100%; height:100%; object-fit:cover;">`;
                                            wishlistCoverPreview.classList.remove('hidden');
                                            const p = wishlistCoverPreview.parentElement.querySelector('.upload-placeholder');
                                            if(p) p.classList.add('hidden');
                                        }
                                    };
                                    reader.readAsDataURL(blob);
                                })
                                .catch(e => console.log("Could not auto-fetch image blob", e));
                        }
                     }, 200);
                } else {
                    // No results, revert to raw text
                     setTimeout(() => {
                        const titleInput = document.getElementById('wishlist-title');
                        if(titleInput) {
                            titleInput.value = query;
                            titleInput.disabled = false;
                        }
                     }, 200);
                }
            } catch (e) {
                console.error("API Error", e);
                 // Error, revert to raw text
                 setTimeout(() => {
                    const titleInput = document.getElementById('wishlist-title');
                    if(titleInput) {
                        titleInput.value = query;
                        titleInput.disabled = false;
                    }
                 }, 200);
            }
        } else {
             setTimeout(() => {
                 const titleInput = document.getElementById('wishlist-title');
                 if(titleInput) {
                     titleInput.value = ""; // No query found
                     titleInput.disabled = false;
                 }
             }, 200);
        }

        // Clean URL
        window.history.replaceState({}, document.title, window.location.pathname);
    }
}



// --- Firestore Methods ---

// Ensure user is searchable
async function updatePublicProfile(user) {
    if(!user.email) return;
    try {
        await setDoc(doc(db, 'public_profiles', user.email), {
            uid: user.uid,
            displayName: user.displayName || user.email.split('@')[0],
            photoURL: user.photoURL
        }, { merge: true });
    } catch (e) {
        console.error("Error updating public profile:", e);
    }
}

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
        filterAndSortReviews();
        updateGoalProgress(currentYearFilter);
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
             filterAndSortReviews();
             updateGoalProgress(currentYearFilter);
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

async function fetchUserGoal() {
    if (!currentUser) return;
    try {
        const docRef = doc(db, `users/${currentUser.uid}/settings`, 'goals');
        const docSnap = await getDoc(docRef);
        if (docSnap.exists()) {
             // Support legacy format (single yearlyTarget) by assigning it to current year if exists
            const data = docSnap.data();
            if (data.yearlyTargets) {
                yearlyGoals = data.yearlyTargets;
            } else if (data.yearlyTarget) {
                yearlyGoals[new Date().getFullYear()] = data.yearlyTarget;
            }
        }
        updateGoalProgress(currentYearFilter);
    } catch (e) {
        console.error("Error fetching goal:", e);
    }
}

async function fetchFriends() {
    if (!currentUser) return;
    try {
        const q = query(collection(db, `users/${currentUser.uid}/following`));
        const querySnapshot = await getDocs(q);
        friends = [];
        querySnapshot.forEach((doc) => {
            friends.push({ id: doc.id, ...doc.data() });
        });
        renderFriends();
    } catch (e) {
        console.error("Error fetching friends:", e);
    }
}

async function addFriend(email) {
    if (!currentUser) return;
    if (email === currentUser.email) {
        alert("You cannot follow yourself!");
        return;
    }
    
    try {
        // 1. Find User by Email in public_profiles
        const publicProfileRef = doc(db, 'public_profiles', email);
        const profileSnap = await getDoc(publicProfileRef);
        
        if (!profileSnap.exists()) {
            alert("User not found. Ask them to log in to Book Journal once!");
            return;
        }
        
        const friendData = profileSnap.data();
        
        // 2. Add to following
        await setDoc(doc(db, `users/${currentUser.uid}/following`, friendData.uid), {
            email: email,
            displayName: friendData.displayName,
            photoURL: friendData.photoURL
        });
        
        alert(`You are now following ${friendData.displayName}!`);
        friendEmailInput.value = '';
        await fetchFriends();
        
    } catch (e) {
        console.error("Error adding friend:", e);
        alert("Failed to add friend.");
    }
}

async function saveUserGoal(year, newGoal) {
    if (!currentUser) return;
    try {
        const updateData = {};
        updateData[`yearlyTargets.${year}`] = newGoal;

        await setDoc(doc(db, `users/${currentUser.uid}/settings`, 'goals'), updateData, { merge: true });
        
        yearlyGoals[year] = newGoal;
        updateGoalProgress(year);
        alert(`Goal for ${year} updated!`);
    } catch (e) {
        console.error("Error saving goal:", e);
        alert("Failed to save goal.");
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

function renderReviews(listToRender = reviews) {
    if (!reviewsGrid) return;
    reviewsGrid.innerHTML = '';
    
    // Empty State Handling
    if (listToRender.length === 0) {
        if (reviews.length === 0) {
            // Totally empty (no reviews at all)
            reviewsGrid.innerHTML = `
                <div class="empty-state">
                    <p>No reviews yet. Start your journal!</p>
                </div>`;
        } else {
            // Search result empty
            reviewsGrid.innerHTML = `
                <div class="empty-state">
                    <p>No reviews match your search.</p>
                </div>`;
        }
        reviewsGrid.innerHTML = `
            <div class="empty-state">
                <p>No reviews yet. Start your journal!</p>
            </div>`;
        if(window.updateAnalytics) window.updateAnalytics();
        return;
    }

    listToRender.forEach(review => {
        const card = document.createElement('div');
        card.className = 'review-card';
        // Basic Card Template
        let starHtml = '';
        for(let i=1; i<=5; i++) {
            if(review.rating >= i) starHtml += '<i class="fa-solid fa-star"></i>';
            else if(review.rating >= i-0.5) starHtml += '<i class="fa-solid fa-star-half-stroke"></i>';
            else starHtml += '<i class="fa-regular fa-star"></i>';
        }

        const coverSrc = review.cover || 'data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%22150%22%20height%3D%22220%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%22150%22%20height%3D%22220%22%20fill%3D%22%23eee%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%23aaa%22%20font-family%3D%22sans-serif%22%20font-size%3D%2220%22%3ENo%20Cover%3C%2Ftext%3E%3C%2Fsvg%3E';
        
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
                     <button class="btn-icon share-review-btn" data-id="${review.id}" title="Share">
                        <i class="fa-solid fa-share-nodes"></i>
                     </button>
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
    
     document.querySelectorAll('.share-review-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = e.currentTarget.dataset.id;
            const review = reviews.find(r => r.id === id);
            shareReview(review);
        });
    });

    if(window.updateAnalytics) window.updateAnalytics();
}

function setupSearchListeners() {
    const searchInput = document.getElementById('search-input');
    const sortSelect = document.getElementById('sort-select');

    if (searchInput) {
        searchInput.addEventListener('input', (e) => {
            currentSearchTerm = e.target.value.toLowerCase().trim();
            filterAndSortReviews();
        });
    }

    if (sortSelect) {
        sortSelect.addEventListener('change', (e) => {
            currentSortOrder = e.target.value;
            filterAndSortReviews();
        });
    }
}

function filterAndSortReviews() {
    // 1. Filter
    let filtered = reviews.filter(r => {
        if (!currentSearchTerm) return true;
        const term = currentSearchTerm;
        const inTitle = r.title && r.title.toLowerCase().includes(term);
        const inAuthor = r.author && r.author.toLowerCase().includes(term);
        const inGenre = r.genre && r.genre.toLowerCase().includes(term);
        return inTitle || inAuthor || inGenre;
    });

    // 2. Sort
    filtered.sort((a, b) => {
        switch (currentSortOrder) {
            case 'date-desc':
                // Newest First
                return (new Date(b.endDate || 0)) - (new Date(a.endDate || 0));
            case 'date-asc':
                // Oldest First
                return (new Date(a.endDate || 0)) - (new Date(b.endDate || 0));
            case 'rating-desc':
                // High to Low
                return (b.rating || 0) - (a.rating || 0);
            case 'rating-asc':
                // Low to High
                return (a.rating || 0) - (b.rating || 0);
            case 'title-asc':
                // A-Z
                return (a.title || '').localeCompare(b.title || '');
            case 'title-desc':
                // Z-A
                return (b.title || '').localeCompare(a.title || '');
            default:
                return 0;
        }
    });

    renderReviews(filtered);
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
        const coverSrc = item.cover || 'data:image/svg+xml;charset=UTF-8,%3Csvg%20width%3D%2280%22%20height%3D%22120%22%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%3E%3Crect%20width%3D%2280%22%20height%3D%22120%22%20fill%3D%22%23eee%22%2F%3E%3Ctext%20x%3D%2250%25%22%20y%3D%2250%25%22%20dominant-baseline%3D%22middle%22%20text-anchor%3D%22middle%22%20fill%3D%22%23aaa%22%20font-family%3D%22sans-serif%22%20font-size%3D%2212%22%3ENo%20Cover%3C%2Ftext%3E%3C%2Fsvg%3E';
        
        card.innerHTML = `
            <img src="${coverSrc}" alt="${item.title}" class="wishlist-cover">
            <div class="wishlist-details">
                <h4 class="wishlist-title">${item.title}</h4>
                <p class="wishlist-author">${item.author}</p>
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

function renderFriends() {
    if (!friendsList) return;
    friendsList.innerHTML = '';
    
    if (friends.length === 0) {
        friendsList.innerHTML = '<p class="empty-text">You aren\'t following anyone yet.</p>';
        return;
    }

    friends.forEach(f => {
        const card = document.createElement('div');
        card.className = 'friend-card';
        card.addEventListener('click', () => openFriendModal(f));
        
        card.innerHTML = `
            <div class="friend-avatar">
                ${f.displayName.charAt(0).toUpperCase()}
            </div>
            <div class="friend-info">
                <h4>${f.displayName}</h4>
                <p>${f.email}</p>
            </div>
        `;
        friendsList.appendChild(card);
    });
}


// Exposed for Analytics to call when filter changes
window.updateGoalProgress = function(year) {
    currentYearFilter = parseInt(year) || new Date().getFullYear();
    updateGoalProgress(currentYearFilter);
}

function updateGoalProgress(year) {
    if (!goalProgressBar || !goalText) return;
    
    const targetYear = year || new Date().getFullYear();
    const targetGoal = yearlyGoals[targetYear] || 10; // Default to 10 if not set

    // Count books finished in this year
    const count = reviews.filter(r => {
        if (!r.endDate) return false;
        return new Date(r.endDate).getFullYear() === targetYear;
    }).length;

    let percentage = (count / targetGoal) * 100;
    if (percentage > 100) percentage = 100;
    
    goalProgressBar.style.width = `${percentage}%`;
    goalText.innerText = `${count} / ${targetGoal} books read in ${targetYear}`;
    
    // Update the heading to reflect the year
    const goalHeading = document.querySelector('.goals-section h3');
    if(goalHeading) goalHeading.textContent = `${targetYear} Reading Goal`;
}

// --- Friend Interaction Logic ---

async function openFriendModal(friend) {
    if (!friendModal) return;
    
    friendModal.classList.remove('hidden');
    friendModalTitle.innerText = `${friend.displayName}'s Journal`;
    
    // Reset Data
    friendGoalBar.style.width = '0%';
    friendGoalText.innerText = 'Loading...';
    friendReviewsGrid.innerHTML = '<p>Loading reviews...</p>';
    
    try {
        // Fetch Goal
        const goalSnap = await getDoc(doc(db, `users/${friend.id}/settings`, 'goals'));
        const fGoal = goalSnap.exists() ? (goalSnap.data().yearlyTarget || 10) : 10;
        
        // Fetch Reviews (Limited)
        const q = query(collection(db, `users/${friend.id}/reviews`), orderBy('createdAt', 'desc')); // limit(5) optional
        const reviewsSnap = await getDocs(q);
        const fReviews = [];
        reviewsSnap.forEach(d => fReviews.push(d.data()));
        
        // Update Goal UI
        const count = fReviews.length;
        let percentage = (count / fGoal) * 100;
        if(percentage > 100) percentage = 100;
        friendGoalBar.style.width = `${percentage}%`;
        friendGoalText.innerText = `${count} / ${fGoal} books read`;
        
        // Render Reviews
        friendReviewsGrid.innerHTML = '';
        if(fReviews.length === 0) {
            friendReviewsGrid.innerHTML = '<p class="empty-text">No reviews visible.</p>';
        } else {
            fReviews.forEach(r => {
                const item = document.createElement('div');
                item.style.cssText = 'padding: 0.8rem; border-bottom: 1px solid #eee; margin-bottom: 0.5rem;';
                item.innerHTML = `
                    <div style="display:flex; justify-content:space-between;">
                        <strong>${r.title}</strong>
                        <span>${'★'.repeat(Math.round(r.rating))}</span>
                    </div>
                    <p style="font-size:0.9rem; color:#666; margin: 0.2rem 0;">by ${r.author}</p>
                    <p style="font-size:0.9rem; margin-top: 5px;">"${r.quote || 'No quote'}"</p>
                `;
                friendReviewsGrid.appendChild(item);
            });
        }
    } catch(e) {
        console.error("Error viewing friend:", e);
        friendReviewsGrid.innerHTML = '<p class="error-text">Unable to load data. They might need to adjust privacy settings.</p>';
    }
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
        if (file.size > 800 * 1024) { 
            alert("Image is too large! Please choose an image under 800KB to save database space.");
            e.target.value = ''; 
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
    
    if (!printWindow) {
        alert("Print popup was blocked. Please allow popups for this site.");
        return;
    }

    const starHtml = '★'.repeat(Math.round(review.rating)) + '☆'.repeat(5 - Math.round(review.rating));
    
    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Review: ${review.title}</title>
            <style>
                body { 
                    font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif; 
                    padding: 40px; 
                    max-width: 800px;
                    margin: 0 auto;
                    color: #333;
                }
                h1 { 
                    font-family: 'Georgia', serif; 
                    margin-bottom: 5px; 
                    font-size: 2em;
                    color: #2c3e50;
                }
                .meta { 
                    color: #7f8c8d; 
                    font-style: italic; 
                    margin-bottom: 20px; 
                    font-size: 1.1em;
                }
                .cover { 
                    max-width: 200px; 
                    float: left; 
                    margin-right: 25px; 
                    margin-bottom: 20px; 
                    border-radius: 4px;
                    box-shadow: 0 4px 10px rgba(0,0,0,0.15);
                }
                .content { 
                    line-height: 1.8; 
                    font-size: 1.1em;
                    overflow-wrap: break-word; /* Prevents overflow */
                    word-wrap: break-word;
                }
                .quote { 
                    background: #f9f9f9;
                    border-left: 5px solid #e67e22; 
                    padding: 15px 20px; 
                    margin: 25px 0; 
                    font-style: italic; 
                    font-size: 1.2em;
                    color: #555;
                    border-radius: 0 8px 8px 0;
                    overflow-wrap: break-word;
                }
                .rating { 
                    color: #f1c40f; 
                    font-size: 1.5em; 
                    margin-bottom: 10px;
                    letter-spacing: 2px;
                }
                .clearfix::after {
                    content: "";
                    clear: both;
                    display: table;
                }
                @media print {
                    body { padding: 0; }
                    .cover { max-width: 150px; }
                }
            </style>
        </head>
        <body>
            <div class="clearfix">
                ${review.cover ? `<img src="${review.cover}" class="cover">` : ''}
                <h1>${review.title}</h1>
                <div class="rating">${starHtml}</div>
                <p class="meta">by ${review.author} • Read: ${formatDate(review.endDate)}</p>
                
                ${review.quote ? `<div class="quote">"${review.quote}"</div>` : ''}
                
                <div class="content">
                    ${review.review.replace(/\n/g, '<br>')}
                </div>
            </div>
            
            <script>
                window.onload = function() { 
                    setTimeout(() => {
                        window.print();
                    }, 500); 
                }
            </script>
        </body>
        </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
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
    const blob = new Blob([csvString], { type: 'text/csv;charset=utf-8;' });
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
    
    // Instead of using jsPDF which has issues with non-Latin scripts (like Hindi),
    // we generate a clean HTML print view that the user can "Save to PDF".
    // This uses the browser's native text rendering engine.
    
    const printWindow = window.open('', '_blank');
    
    if (!printWindow) {
        alert("Popups blocked. Please allow popups to export.");
        return;
    }

    const dateStr = new Date().toLocaleDateString();
    
    // Build HTML for all reviews
    let cardsHtml = '';
    
    reviews.forEach(review => {
        const starHtml = '★'.repeat(Math.round(review.rating)) + '☆'.repeat(5 - Math.round(review.rating));
        
        cardsHtml += `
            <div class="review-card">
                <div class="card-content clearfix">
                    ${review.cover ? `<div class="card-image"><img src="${review.cover}"></div>` : ''}
                    <div class="card-details">
                        <h2>${review.title}</h2>
                        <p class="author">by ${review.author}</p>
                        <div class="rating">${starHtml}</div>
                        <p class="dates">${formatDate(review.startDate)} - ${formatDate(review.endDate)}</p>
                        ${review.genre ? `<span class="genre">${review.genre}</span>` : ''}
                        
                        ${review.quote ? `<div class="quote">"${review.quote}"</div>` : ''}
                        <div class="review-text">${review.review ? review.review.replace(/\n/g, '<br>') : ''}</div>
                    </div>
                </div>
            </div>
        `;
    });

    const htmlContent = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>My Reading Journal</title>
            <style>
                body {
                    font-family: 'Segoe UI', 'Helvetica Neue', Helvetica, Arial, sans-serif;
                    background: #fff;
                    color: #333;
                    padding: 40px;
                    max-width: 900px;
                    margin: 0 auto;
                }
                header {
                    border-bottom: 2px solid #2c3e50;
                    padding-bottom: 20px;
                    margin-bottom: 40px;
                    text-align: center;
                }
                header h1 {
                    font-family: 'Georgia', serif;
                    font-size: 2.5em;
                    color: #2c3e50;
                    margin: 0;
                }
                header p {
                    color: #7f8c8d;
                    margin-top: 5px;
                }
                
                .review-card {
                    margin-bottom: 40px;
                    border: 1px solid #eee;
                    border-radius: 8px;
                    padding: 25px;
                    box-shadow: 0 4px 6px rgba(0,0,0,0.05);
                    page-break-inside: avoid; /* Keep card together */
                    background: #fff;
                }
                
                .clearfix::after {
                    content: "";
                    clear: both;
                    display: table;
                }

                .card-image {
                    float: left;
                    width: 120px;
                    margin-right: 25px;
                }
                .card-image img {
                    width: 100%;
                    border-radius: 4px;
                    box-shadow: 0 2px 5px rgba(0,0,0,0.1);
                }
                
                .card-details {
                    overflow: hidden; /* Triggers BFC to wrap around float */
                }
                
                h2 {
                    margin-top: 0;
                    margin-bottom: 5px;
                    color: #2c3e50;
                    font-size: 1.6em;
                }
                
                .author {
                    color: #7f8c8d;
                    font-style: italic;
                    margin-top: 0;
                    margin-bottom: 10px;
                }
                
                .rating {
                    color: #f1c40f;
                    font-size: 1.2em;
                    letter-spacing: 2px;
                    margin-bottom: 10px;
                }
                
                .dates {
                    font-size: 0.9em;
                    color: #95a5a6;
                }
                
                .genre {
                    display: inline-block;
                    background: #f0f0f0;
                    padding: 2px 8px;
                    border-radius: 12px;
                    font-size: 0.8em;
                    color: #555;
                    margin-bottom: 15px;
                }
                
                .quote {
                    background: #fff8f0;
                    border-left: 4px solid #e67e22;
                    padding: 10px 15px;
                    margin: 15px 0;
                    font-style: italic;
                    color: #555;
                    overflow-wrap: break-word; /* Handle long words */
                }
                
                .review-text {
                    line-height: 1.6;
                    color: #444;
                    overflow-wrap: break-word; /* Handle long words */
                    word-wrap: break-word;
                }

                @media print {
                    body { padding: 0; margin: 0; }
                    .review-card { box-shadow: none; border: 1px solid #ddd; }
                    /* Ensure background colors print */
                    .quote, .genre { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
                }
            </style>
        </head>
        <body>
            <header>
                <h1>My Reading Journal</h1>
                <p>Exported on ${dateStr}</p>
            </header>
            
            ${cardsHtml}
            
            <script>
                window.onload = function() { 
                    setTimeout(() => {
                        window.print();
                    }, 1000); // Give images a sec
                }
            </script>
        </body>
        </html>
    `;

    printWindow.document.write(htmlContent);
    printWindow.document.close();
    printWindow.focus();
}

function shareReview(review) {
    if (navigator.share) {
        navigator.share({
            title: `Review: ${review.title}`,
            text: `I just reviewed "${review.title}" by ${review.author}. I gave it ${review.rating} stars! "${review.quote}"`,
            url: window.location.href
        }).catch(err => {
            console.log('Share failed:', err);
        });
    } else {
        const text = `I just reviewed "${review.title}" by ${review.author}. I gave it ${review.rating} stars! "${review.quote}"`;
        navigator.clipboard.writeText(text).then(() => {
            alert("Review copied to clipboard!");
        }).catch(() => {
            alert("Failed to copy review.");
        });
    }
}


// --- Event Listeners ---
    // START: Wishlist Share & Export
    function shareWishlist() {
        if(!wishlist || wishlist.length === 0) {
            alert("Your wishlist is empty!");
            return;
        }

        let text = "📚 My Want to Read List:\n\n";
        wishlist.forEach(book => {
            text += `- ${book.title} by ${book.author}\n`;
            if(book.link) text += `  ${book.link}\n`;
            text += "\n";
        });

        if (navigator.share) {
            navigator.share({
                title: 'My Book Wishlist',
                text: text
            }).catch(err => console.log('Error sharing:', err));
        } else {
            // Fallback
            navigator.clipboard.writeText(text).then(() => {
                alert("List copied to clipboard!");
            });
        }
    }

    function exportWishlistPdf() {
         if(!wishlist || wishlist.length === 0) {
            alert("Your wishlist is empty!");
            return;
        }
        // Redirect to printWishlist() effectively, since we want the same HTML print engine
        printWishlist();
    }

    function printWishlist() {
         if(!wishlist || wishlist.length === 0) {
            alert("Your wishlist is empty!");
            return;
        }

        const printWindow = window.open('', '_blank');
         if (!printWindow) {
            alert("Print popup was blocked. Please allow popups for this site.");
            return;
        }
        
        const listHtml = wishlist.map(book => `
            <div class="book-item">
                ${book.cover ? `<img src="${book.cover}" class="cover">` : '<div class="cover placeholder">No Cover</div>'}
                <div class="details">
                    <h3>${book.title}</h3>
                    <p class="author">by ${book.author}</p>
                    ${book.link ? `<p class="link"><a href="${book.link}">${book.link}</a></p>` : ''}
                </div>
            </div>
        `).join('');

        const htmlContent = `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>My Want To Read List</title>
                <style>
                    body { 
                        font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
                        padding: 40px; 
                        max-width: 800px;
                        margin: 0 auto;
                        color: #333;
                    }
                    h1 { 
                        border-bottom: 2px solid #2c3e50; 
                        padding-bottom: 10px; 
                        margin-bottom: 30px; 
                        color: #2c3e50;
                    }
                    .book-item { 
                        display: flex; 
                        gap: 20px; 
                        margin-bottom: 20px; 
                        border-bottom: 1px solid #eee; 
                        padding-bottom: 20px; 
                        page-break-inside: avoid; 
                    }
                    .cover { 
                        width: 80px; 
                        height: 120px; 
                        object-fit: cover; 
                        border: 1px solid #ddd; 
                        flex-shrink: 0; 
                        border-radius: 4px;
                        box-shadow: 0 2px 4px rgba(0,0,0,0.1);
                    }
                    .placeholder { 
                        display: flex; 
                        align-items: center; 
                        justify-content: center; 
                        background: #eee; 
                        color: #777; 
                        font-size: 0.8rem; 
                        text-align: center; 
                    }
                    .details { flex: 1; }
                    h3 { margin: 0 0 5px 0; color: #2c3e50; font-size: 1.2em; }
                    .author { margin: 0 0 10px 0; color: #555; font-style: italic; }
                    .link { margin: 0; font-size: 0.85rem; word-break: break-all; }
                    .link a { color: #3498db; text-decoration: none; }
                </style>
            </head>
            <body>
                <h1>My Want To Read List</h1>
                ${listHtml}
                <script>
                    window.onload = function() { 
                        setTimeout(() => {
                            window.print(); 
                        }, 500);
                    }
                </script>
            </body>
            </html>
        `;
        
        printWindow.document.write(htmlContent);
        printWindow.document.close();
        printWindow.focus();
    }

    // END: Wishlist Share & Export

function setupEventListeners() {
    // Wishlist Share/PDF Listeners
    if(shareWishlistBtn) {
        shareWishlistBtn.addEventListener('click', shareWishlist);
    }
    if(printWishlistBtn) {
        printWishlistBtn.addEventListener('click', printWishlist);
    }
    if(exportWishlistPdfBtn) {
        exportWishlistPdfBtn.addEventListener('click', exportWishlistPdf);
    }
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
            if(friendModal) friendModal.classList.add('hidden');
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

    // Goal Edit Listener
    if (editGoalBtn) {
        editGoalBtn.addEventListener('click', () => {
            // Get currently selected year from the UI if possible, or use current state
            const year = currentYearFilter;
            const currentGoal = yearlyGoals[year] || 10;
            
            const newGoal = prompt(`Enter reading goal for ${year}:`, currentGoal);
            if (newGoal && !isNaN(newGoal) && newGoal > 0) {
                saveUserGoal(year, parseInt(newGoal));
            }
        });
    }
    
    // Add Friend Listener
    if(addFriendForm) {
        addFriendForm.addEventListener('submit', async (e) => {
            e.preventDefault();
            const email = friendEmailInput.value.trim();
            if(email) {
                await addFriend(email);
            }
        });
    }

    // Mobile Menu Toggle
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const navLinksList = document.getElementById('nav-links-list');

    if (mobileMenuBtn && navLinksList) {
        mobileMenuBtn.addEventListener('click', () => {
            navLinksList.classList.toggle('show-mobile');
            const icon = mobileMenuBtn.querySelector('i');
            if (navLinksList.classList.contains('show-mobile')) {
                icon.classList.remove('fa-bars');
                icon.classList.add('fa-xmark');
            } else {
                icon.classList.remove('fa-xmark');
                icon.classList.add('fa-bars');
            }
        });
        
        // Auto-close on link click
        navLinksList.querySelectorAll('li').forEach(li => {
            li.addEventListener('click', () => {
                navLinksList.classList.remove('show-mobile');
                const icon = mobileMenuBtn.querySelector('i');
                icon.classList.remove('fa-xmark');
                icon.classList.add('fa-bars');
            });
        });
    }
}

// Expose for Analytics
window.getReviews = () => reviews;
window.reviewManager = {
    getAllReviews: () => reviews
};
