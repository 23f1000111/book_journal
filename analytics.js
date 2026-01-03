// Analytics Engine

let charts = {}; // Store chart instances

window.updateAnalytics = function () {
    if (!window.reviewManager) return;
    const reviews = window.reviewManager.getAllReviews();

    updateStats(reviews);
    updateCharts(reviews);
    populateYearFilter(reviews);
};

function updateStats(reviews) {
    // Total Books
    const totalBooksParam = document.getElementById('stat-total-books');
    if (totalBooksParam) totalBooksParam.textContent = reviews.length;

    if (reviews.length === 0) {
        setText('stat-avg-rating', '0.0');
        setText('stat-reading-days', '0');
        setText('stat-top-genre', '-');
        return;
    }

    // Avg Rating
    const totalRating = reviews.reduce((sum, r) => sum + (parseFloat(r.rating) || 0), 0);
    const avg = (totalRating / reviews.length).toFixed(1);
    setText('stat-avg-rating', avg);

    // Reading Days
    let totalDays = 0;
    reviews.forEach(r => {
        if (r.startDate && r.endDate) {
            const start = new Date(r.startDate);
            const end = new Date(r.endDate);
            const diff = Math.ceil((end - start) / (1000 * 60 * 60 * 24));
            // Just sum up differences. If overlapping, this logic counts them as extra days of reading effort
            // which is acceptable for "Total Reading Days" (effort).
            if (diff >= 0) totalDays += diff + 1;
        }
    });
    setText('stat-reading-days', totalDays);

    // Top Genre
    const genreCounts = {};
    reviews.forEach(r => {
        genreCounts[r.genre] = (genreCounts[r.genre] || 0) + 1;
    });
    if (Object.keys(genreCounts).length > 0) {
        const topGenre = Object.keys(genreCounts).reduce((a, b) => genreCounts[a] > genreCounts[b] ? a : b);
        setText('stat-top-genre', topGenre);
    } else {
        setText('stat-top-genre', '-');
    }
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
}

function updateCharts(reviews) {
    const ctx1 = document.getElementById('chart-books-month');
    const ctx2 = document.getElementById('chart-rating-dist');
    const ctx3 = document.getElementById('chart-genre-dist');
    const ctx4 = document.getElementById('chart-trend');

    // Make sure we have the elements
    if (!ctx1 || !ctx2 || !ctx3 || !ctx4) return;

    // Filter by Year if selected
    const yearFilter = document.getElementById('year-filter');
    const selectedYear = yearFilter && yearFilter.value ? parseInt(yearFilter.value) : new Date().getFullYear();

    const filteredReviews = reviews.filter(r => {
        if (!r.endDate) return false;
        return new Date(r.endDate).getFullYear() === selectedYear;
    });

    // Process data
    const monthCounts = new Array(12).fill(0);
    const ratingCounts = new Array(5).fill(0);
    const genreCounts = {};

    filteredReviews.forEach(r => {
        // Monthly
        const date = new Date(r.endDate);
        if (!isNaN(date.getTime())) {
            const month = date.getMonth();
            monthCounts[month]++;
        }

        // Ratings
        if (r.rating >= 1 && r.rating <= 5) {
            ratingCounts[r.rating - 1]++;
        }

        // Genres
        if (r.genre) {
            genreCounts[r.genre] = (genreCounts[r.genre] || 0) + 1;
        }
    });

    // 1. Books per Month
    renderChart(ctx1, 'booksMonth', 'bar', {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        datasets: [{
            label: `Books Read in ${selectedYear}`,
            data: monthCounts,
            backgroundColor: '#e67e22',
            borderRadius: 4
        }]
    });

    // 2. Rating Distribution
    renderChart(ctx2, 'ratingDist', 'bar', {
        labels: ['1 Star', '2 Stars', '3 Stars', '4 Stars', '5 Stars'],
        datasets: [{
            label: 'Count',
            data: ratingCounts,
            backgroundColor: ['#e74c3c', '#e67e22', '#f1c40f', '#2ecc71', '#3498db'],
            borderRadius: 4
        }]
    });

    // 3. Genre Distribution
    renderChart(ctx3, 'genreDist', 'doughnut', {
        labels: Object.keys(genreCounts),
        datasets: [{
            data: Object.values(genreCounts),
            backgroundColor: [
                '#3498db', '#e74c3c', '#9b59b6', '#2ecc71', '#f1c40f',
                '#e67e22', '#1abc9c', '#34495e', '#95a5a6', '#d35400'
            ],
            borderWidth: 0
        }]
    });

    // 4. Trend (Cumulative Books over the year)
    let cumulative = 0;
    const cumulativeData = monthCounts.map(count => {
        cumulative += count;
        return cumulative;
    });

    renderChart(ctx4, 'trend', 'line', {
        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
        datasets: [{
            label: 'Total Books Read (Cumulative)',
            data: cumulativeData,
            borderColor: '#2c3e50',
            backgroundColor: 'rgba(44, 62, 80, 0.1)',
            fill: true,
            tension: 0.3
        }]
    });
}

function renderChart(canvas, id, type, data) {
    if (charts[id]) {
        charts[id].destroy();
        charts[id] = null;
    }

    // Global styling
    Chart.defaults.font.family = "'Outfit', sans-serif";
    Chart.defaults.color = '#7f8c8d';

    charts[id] = new Chart(canvas, {
        type: type,
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: type === 'doughnut',
                    position: 'bottom'
                }
            },
            scales: (type === 'doughnut') ? {} : {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1 }
                },
                x: {
                    grid: { display: false }
                }
            }
        }
    });
}

function populateYearFilter(reviews) {
    const select = document.getElementById('year-filter');
    if (!select) return;

    const currentYear = new Date().getFullYear();
    const years = new Set([currentYear]);

    reviews.forEach(r => {
        if (r.endDate) years.add(new Date(r.endDate).getFullYear());
    });

    // Check if we need to rebuild options
    // Only rebuild if the number of options is different
    // (Simple check to avoid clearing selection on every update)
    if (select.options.length !== years.size) {
        const savedValue = select.value;
        select.innerHTML = '';
        Array.from(years).sort((a,b) => b - a).forEach(year => {
            const option = document.createElement('option');
            option.value = year;
            option.textContent = year;
            select.appendChild(option);
        });
        if (savedValue && years.has(parseInt(savedValue))) {
            select.value = savedValue;
        } else {
            select.value = currentYear;
        }
    }
}

// Event Listeners for Analytics
document.addEventListener('DOMContentLoaded', () => {

    // Export Analytics
    const exportBtn = document.getElementById('export-analytics-btn');
    if (exportBtn) {
        exportBtn.addEventListener('click', () => {
            const element = document.querySelector('#analytics-view');
            const controls = element.querySelector('.controls');
            if (controls) controls.style.display = 'none'; // hide controls from pdf

            // Temporary styling for better PDF output
            const originalWidth = element.style.width;
            const originalPadding = element.style.padding;
            const originalMargin = element.style.margin;
            
            element.style.width = '1100px'; // Force fixed width to fit landscape A4 nicely
            element.style.padding = '20px';
            element.style.margin = '0 auto';

            const opt = {
                margin: 10,
                filename: 'Reading_Analytics.pdf',
                image: { type: 'jpeg', quality: 0.98 },
                html2canvas: { scale: 2, useCORS: true }, 
                jsPDF: { unit: 'mm', format: 'a4', orientation: 'landscape' },
                pagebreak: { mode: ['avoid-all', 'css', 'legacy'] }
            };

            html2pdf().set(opt).from(element).save()
            .then(() => {
                // Success
            })
            .catch(err => {
                console.error("Export failed:", err);
                alert("Failed to generate report. Please try again.");
            })
            .finally(() => {
                if (controls) controls.style.display = 'flex';
                // Restore styles
                element.style.width = originalWidth;
                element.style.padding = originalPadding;
                element.style.margin = originalMargin;
                element.style.height = ''; 
            });
        });
    }

    // Year Filter Change
    const yearFilter = document.getElementById('year-filter');
    if (yearFilter) {
        yearFilter.addEventListener('change', () => {
            if (window.updateAnalytics) window.updateAnalytics();
        });
    }
});
