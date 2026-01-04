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
    const ratingCounts = new Array(10).fill(0);
    const genreCounts = {};

    filteredReviews.forEach(r => {
        // Monthly
        const date = new Date(r.endDate);
        if (!isNaN(date.getTime())) {
            const month = date.getMonth();
            monthCounts[month]++;
        }

        // Ratings (0.5 to 5.0)
        if (r.rating >= 0.5 && r.rating <= 5) {
            // Map 0.5->0, 1.0->1, 1.5->2 ... 5.0->9
            // Formula: (rating * 2) - 1
            const index = Math.round(r.rating * 2) - 1;
            if (index >= 0 && index < 10) {
                ratingCounts[index]++;
            }
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
        labels: ['0.5', '1', '1.5', '2', '2.5', '3', '3.5', '4', '4.5', '5'],
        datasets: [{
            label: 'Count',
            data: ratingCounts,
            backgroundColor: [
                '#c0392b', '#e74c3c', // Reds
                '#d35400', '#e67e22', // Oranges
                '#f39c12', '#f1c40f', // Yellows
                '#27ae60', '#2ecc71', // Greens
                '#2980b9', '#3498db'  // Blues
            ],
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
    Chart.defaults.font.size = 12;
    Chart.defaults.scale.grid.borderColor = '#f0f0f0'; // Subtle border

    charts[id] = new Chart(canvas, {
        type: type,
        data: data,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    display: type === 'doughnut',
                    position: 'bottom',
                    labels: {
                        usePointStyle: true,
                        padding: 20,
                        pointStyle: 'circle'
                    }
                },
                tooltip: {
                    backgroundColor: 'rgba(255, 255, 255, 0.95)',
                    titleColor: '#2c3e50',
                    bodyColor: '#2c3e50',
                    borderColor: '#eee',
                    borderWidth: 1,
                    padding: 10,
                    boxPadding: 4,
                    usePointStyle: true,
                     titleFont: { family: "'Outfit', sans-serif", weight: '600' }
                }
            },
            scales: (type === 'doughnut') ? {} : {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1, padding: 10 },
                    grid: { color: '#f0f0f0', drawBorder: false }
                },
                x: {
                    grid: { display: false, drawBorder: false }
                }
            },
            elements: {
                line: { cubicInterpolationMode: 'monotone' },
                bar: { borderRadius: 4 }
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
            const loadingOverlay = document.getElementById('loading-overlay');
            if (loadingOverlay) loadingOverlay.classList.remove('hidden');

            setTimeout(() => {
                try {
                    // Robust check
                    const jsPDF = window.jspdf ? window.jspdf.jsPDF : window.jsPDF;
                    
                    if (!jsPDF) {
                        console.error("jsPDF not found");
                        alert("PDF Library error. Please reload.");
                        if(loadingOverlay) loadingOverlay.classList.add('hidden');
                        return;
                    }
                    
                    const doc = new jsPDF('l', 'mm', 'a4'); // Landscape

                    // Title
                    doc.setFontSize(22);
                    doc.setTextColor(44, 62, 80);
                    doc.text("Reading Analytics Report", 15, 20);

                    // Stats Text
                    doc.setFontSize(12);
                    doc.setTextColor(100);
                    
                    const totalBooks = document.getElementById('stat-total-books')?.textContent || "0";
                    const avgRating = document.getElementById('stat-avg-rating')?.textContent || "0";
                    const days = document.getElementById('stat-reading-days')?.textContent || "0";
                    
                    let y = 35;
                    doc.text(`Total Books: ${totalBooks}`, 15, y);
                    doc.text(`Avg Rating: ${avgRating}`, 60, y);
                    doc.text(`Reading Days: ${days}`, 110, y);
                    
                    // Capture Charts
                    const chartIds = ['chart-books-month', 'chart-rating-dist', 'chart-genre-dist', 'chart-trend'];
                    const pageHeight = doc.internal.pageSize.getHeight();
                    const pageWidth = doc.internal.pageSize.getWidth();
                    
                    let x = 15;
                    y = 50; 
                    const w = (pageWidth - 40) / 2; // 2 per row
                    const h = 70;

                    chartIds.forEach((id, index) => {
                        const canvas = document.getElementById(id);
                        if(canvas) {
                            const imgData = canvas.toDataURL('image/jpeg', 1.0);
                            
                            // 2x2 Grid Logic
                            if (index === 2) { // New Row
                                x = 15;
                                y += h + 10;
                            } else if (index === 1 || index === 3) {
                                x += w + 10;
                            }
                            
                            // Add Title above chart
                            doc.setFontSize(10);
                            doc.setTextColor(50);
                            let title = id.replace('chart-', '').replace('-', ' ').toUpperCase();
                            doc.text(title, x, y - 2);

                            doc.addImage(imgData, 'JPEG', x, y, w, h);
                        }
                    });

                    doc.save('reading_analytics_report.pdf');
                } catch (e) {
                    console.error("PDF Export Error", e);
                    alert("Failed to export analytics.");
                } finally {
                    if (loadingOverlay) loadingOverlay.classList.add('hidden');
                }
            }, 100);
        });
    }

    // Year Filter Change
    const yearFilter = document.getElementById('year-filter');
    if (yearFilter) {
        yearFilter.addEventListener('change', () => {
            if (window.updateAnalytics) window.updateAnalytics();
            if (window.updateGoalProgress) window.updateGoalProgress(yearFilter.value);
        });
    }
});
