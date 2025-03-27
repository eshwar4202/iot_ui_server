const FIREBASE_URL = "https://iotsecurity-30d1a-default-rtdb.firebaseio.com";
const VEHICLE_PREDICTION_API_URL = "/proxy_predict";
const ATTACK_PREDICTION_API_URL = "/proxy_attack_predict";
const isDashboard = window.location.pathname === "/";
const isDataVis = window.location.pathname === "/data_vis";

if (isDashboard) {
  async function updateDashboard() {
    const lanes = ["lane_1", "lane_2"];
    let latestCounts = { lane_1: 0, lane_2: 0 };
    for (const lane of lanes) {
      try {
        const response = await fetch(`${FIREBASE_URL}/sensors/${lane}.json`);
        const data = await response.json();
        if (data) {
          const entries = Object.entries(data);
          const latestEntry = entries.sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp))[0];
          latestCounts[lane] = latestEntry[1].vehicle_count;
        }
      } catch (error) {
        console.error(`Error fetching ${lane} data:`, error);
      }
    }
    document.getElementById("lane1-count").textContent = latestCounts.lane_1;
    document.getElementById("lane2-count").textContent = latestCounts.lane_2;
    try {
      const response = await fetch(`${FIREBASE_URL}/attacks.json`);
      const data = await response.json();
      if (data) {
        const entries = Object.entries(data);
        const latestAttack = entries.sort((a, b) => new Date(b[1].timestamp) - new Date(a[1].timestamp))[0][1];
        const attackTime = new Date(latestAttack.timestamp);
        const now = new Date();
        const timeDiff = (now - attackTime) / (1000 * 60);
        if (timeDiff <= 5) {
          document.getElementById("attackStatus").textContent =
            `Attack detected: ${latestAttack.category} - ${latestAttack.description} at ${latestAttack.timestamp}`;
          document.getElementById("attackStatus").style.color = "red";
        } else {
          document.getElementById("attackStatus").textContent = "No recent attacks detected";
          document.getElementById("attackStatus").style.color = "white";
        }
      }
    } catch (error) {
      console.error("Error fetching attack data:", error);
    }

    try {
      const response = await fetch(`${FIREBASE_URL}/predicted_lane.json`);
      const data = await response.json();
      if (data) {
        document.getElementById("predicted-lane").textContent = `Predicted Lane: ${data.lane}`;
      }
    } catch (error) {
      console.error("Error fetching predicted lane data:", error);
    }

    console.log("Dashboard updated:", latestCounts);
  }

  async function predictVehicleCount() {
    const lane = document.getElementById("laneSelect").value;
    const datetimeInput = document.getElementById("datetimeInput").value;

    if (!lane || !datetimeInput) {
      document.getElementById("predictedCount").textContent = "Error: Please select lane and datetime";
      return;
    }

    const timestamp = new Date(datetimeInput).toISOString().replace("T", " ").slice(0, 19);

    const requestBody = {
      lane: lane,
      timestamp: timestamp
    };

    try {
      const response = await fetch(VEHICLE_PREDICTION_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
      }

      const data = await response.json();
      document.getElementById("predictedCount").textContent = data.predicted_vehicle_count;
      console.log("Vehicle prediction result:", data);
    } catch (error) {
      document.getElementById("predictedCount").textContent = "Error fetching prediction";
      console.error("Error predicting vehicle count:", error);
    }
  }

  async function predictAttack() {
    const datetimeInput = document.getElementById("attackDatetimeInput").value;

    if (!datetimeInput) {
      document.getElementById("predictedAttack").textContent = "Error: Please select datetime";
      return;
    }

    const date = new Date(datetimeInput);
    const timestamp = date.toISOString().slice(0, 19).replace("T", "T") + ".460103";

    const requestBody = {
      timestamp: timestamp
    };

    try {
      const response = await fetch(ATTACK_PREDICTION_API_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP error! Status: ${response.status}, Details: ${errorText}`);
      }

      // Get raw text and replace NaN with null to make it valid JSON
      const rawText = await response.text();
      console.log("Raw attack prediction response:", rawText);
      const fixedText = rawText.replace("NaN", "null"); // Replace NaN with null

      // Parse the fixed JSON
      const data = JSON.parse(fixedText);
      document.getElementById("predictedAttack").textContent =
        data.predicted_attack === null ? "NaN" : data.predicted_attack; // Display "NaN" for null
      console.log("Parsed attack prediction result:", data);
    } catch (error) {
      document.getElementById("predictedAttack").textContent = "Error fetching prediction";
      console.error("Error predicting attack:", error.message);
    }
  }

  window.predictVehicleCount = predictVehicleCount;
  window.predictAttack = predictAttack;

  updateDashboard();
  setInterval(updateDashboard, 30000);
}

if (isDataVis) {
  console.log("Initializing charts on /data_vis");
  const trafficFlowCtx = document.getElementById('trafficFlowChart');
  let trafficFlowChart;
  if (!trafficFlowCtx) {
    console.error("Traffic Flow Chart canvas not found!");
  } else {
    trafficFlowChart = new Chart(trafficFlowCtx.getContext('2d'), {
      type: 'line',
      data: {
        labels: [],
        datasets: [
          { label: 'Lane 1', data: [], borderColor: '#0bda5b', fill: false },
          { label: 'Lane 2', data: [], borderColor: '#1a73e8', fill: false }
        ]
      },
      options: {
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Vehicle Count', color: '#9dabb8' }, ticks: { color: '#9dabb8' } },
          x: { title: { display: true, text: 'Time (Hour)', color: '#9dabb8' }, ticks: { color: '#9dabb8' } }
        },
        plugins: { legend: { labels: { color: '#9dabb8' } } }
      }
    });
    console.log("Traffic Flow Chart initialized");
  }

  const attackCountCtx = document.getElementById('attackCountChart');
  let attackCountChart;
  if (!attackCountCtx) {
    console.error("Attack Count Chart canvas not found!");
  } else {
    attackCountChart = new Chart(attackCountCtx.getContext('2d'), {
      type: 'bar',
      data: {
        labels: [],
        datasets: [{ label: 'Attacks', data: [], backgroundColor: '#ff6b6b' }]
      },
      options: {
        scales: {
          y: { beginAtZero: true, title: { display: true, text: 'Attack Count', color: '#9dabb8' }, ticks: { color: '#9dabb8' } },
          x: { title: { display: true, text: 'Date', color: '#9dabb8' }, ticks: { color: '#9dabb8' } }
        },
        plugins: { legend: { labels: { color: '#9dabb8' } } }
      }
    });
    console.log("Attack Count Chart initialized");
  }

  async function fetchTrafficData(timeUnit) {
    const lanes = ['lane_1', 'lane_2'];
    const timeData = { lane_1: {}, lane_2: {} };
    for (const lane of lanes) {
      try {
        const response = await fetch(`${FIREBASE_URL}/sensors/${lane}.json`);
        const data = await response.json();
        if (!data) continue;
        Object.values(data).forEach(entry => {
          const timestamp = new Date(entry.timestamp);
          let key;
          if (timeUnit === 'hour') {
            key = timestamp.getHours();
          } else if (timeUnit === 'minute') {
            key = `${timestamp.getHours()}:${String(timestamp.getMinutes()).padStart(2, '0')}`;
          } else if (timeUnit === 'second') {
            key = `${timestamp.getHours()}:${String(timestamp.getMinutes()).padStart(2, '0')}:${String(timestamp.getSeconds()).padStart(2, '0')}`;
          }
          timeData[lane][key] = (timeData[lane][key] || 0) + entry.vehicle_count;
        });
      } catch (error) {
        console.error(`Error fetching traffic data for ${lane}:`, error);
      }
    }
    if (trafficFlowChart) {
      updateTrafficChart(timeData, timeUnit, trafficFlowChart);
    }
  }

  function updateTrafficChart(timeData, timeUnit, chart) {
    let labels;
    if (timeUnit === 'hour') {
      labels = Array.from({ length: 24 }, (_, i) => i);
    } else if (timeUnit === 'minute') {
      labels = Array.from({ length: 1440 }, (_, i) => {
        const hour = Math.floor(i / 60);
        const minute = i % 60;
        return `${hour}:${String(minute).padStart(2, '0')}`;
      });
    } else if (timeUnit === 'second') {
      labels = Array.from({ length: 86400 }, (_, i) => {
        const hour = Math.floor(i / 3600);
        const minute = Math.floor((i % 3600) / 60);
        const second = i % 60;
        return `${hour}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
      });
    }
    chart.data.labels = labels;
    chart.data.datasets[0].data = labels.map(label => timeData.lane_1[label] || 0);
    chart.data.datasets[1].data = labels.map(label => timeData.lane_2[label] || 0);
    chart.options.scales.x.title.text = `Time (${timeUnit.charAt(0).toUpperCase() + timeUnit.slice(1)})`;
    chart.update();
    console.log(`Traffic chart updated by ${timeUnit}:`, timeData);
  }

  async function fetchAttackData() {
    const dailyAttacks = {};
    try {
      const response = await fetch(`${FIREBASE_URL}/attacks.json`);
      const data = await response.json();
      if (!data) return;
      Object.values(data).forEach(attack => {
        const date = attack.timestamp.split(' ')[0];
        dailyAttacks[date] = (dailyAttacks[date] || 0) + 1;
      });
      if (attackCountChart) {
        updateAttackChart(dailyAttacks, attackCountChart);
      }
    } catch (error) {
      console.error("Error fetching attack data:", error);
    }
  }

  function updateAttackChart(dailyAttacks, chart) {
    const dates = Object.keys(dailyAttacks).sort();
    chart.data.labels = dates;
    chart.data.datasets[0].data = dates.map(d => dailyAttacks[d]);
    chart.update();
    console.log("Attack chart updated:", dailyAttacks);
  }

  fetchTrafficData('hour');
  fetchAttackData();

  const timeUnitSelect = document.getElementById('timeUnit');
  if (timeUnitSelect) {
    timeUnitSelect.addEventListener('change', (event) => {
      const selectedUnit = event.target.value;
      fetchTrafficData(selectedUnit);
    });
    console.log("Dropdown listener added");
  } else {
    console.error("Time unit select element not found!");
  }

  // Update traffic lights based on vehicle count
function updateTrafficLight(laneElementId, count) {
    const light = document.getElementById(laneElementId).closest('.card').querySelector('.traffic-light');
    const [red, yellow, green] = light.querySelectorAll('.traffic-light-bulb');
    
    // Remove all active classes
    [red, yellow, green].forEach(bulb => bulb.classList.remove('active'));
    
    // Determine status (example thresholds - adjust as needed)
    if(count > 30) {
        red.classList.add('active');
    } else if(count > 15) {
        yellow.classList.add('active');
    } else {
        green.classList.add('active');
    }
}

// Usage in updateDashboard():
updateTrafficLight('lane1-count', latestCounts.lane_1);
updateTrafficLight('lane2-count', latestCounts.lane_2);

  setInterval(() => {
    const currentUnit = timeUnitSelect ? timeUnitSelect.value : 'hour';
    fetchTrafficData(currentUnit);
    fetchAttackData();
  }, 30000);
}