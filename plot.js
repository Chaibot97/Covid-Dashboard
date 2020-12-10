/* global d3 */

async function updateCovidData(dataMap) {
  const resp = await fetch('https://api.covidactnow.org/v2/states.json?apiKey=9cb6b2a48d454f8fbf21fb74b5f7d106');

  let data = await resp.json();

  data = data.map((e) => {
    const d = e;
    d.state = dataMap[e.state];
    return d;
  });

  data = data.filter((elem) => elem.metrics && elem.state);

  console.log('Covid Act Now Data:');
  console.log(data);

  return data;
}

function StateCodeToName(json) {
  const dataMap = {};
  json.forEach((e) => {
    dataMap[e.Code] = e.State;
  });
  return dataMap;
}

// calcluate the projected case density after 14 days
// using the model that each day each patient will infect infectionRate/14 new people
// and each day 1/14 of the patients will recover.
function projectDensity(stateData) {
  const currentDensity = stateData.metrics.caseDensity;
  const { population } = stateData;
  const { infectionRate } = stateData.metrics;
  const res = [currentDensity];
  let infected = currentDensity * (population / 100000);
  for (let i = 0; i < 14; i += 1) {
    const recovered = infected / 14;
    const newInfected = infected * (infectionRate / 14);
    infected = infected + newInfected - recovered;
    res.push(infected / (population / 100000));
  }
  return res;
}

let covidData = [];
let hoverState;
let selectState = [];
let barType = 'cases';

/*
  Choropleth map for case density
*/
function plotGeo(data) {
  const plot = d3.select('#plot_geo');

  // get width and height of svg
  const w = plot.node().clientWidth;
  const h = plot.node().clientHeight;

  // Define map projection
  const projection = d3.geoAlbersUsa()
    .translate([w / 2 - 20, h / 2])
    .scale(Math.min(w, h * 1.8));

  // Define path generator
  const path = d3.geoPath()
    .projection(projection);

  // Define quantize scale to sort data values into buckets of color
  const color = d3.scaleLinear()
    .range([93, 25])
    .domain([
      d3.min(data, (d) => d.metrics.caseDensity),
      d3.max(data, (d) => d.metrics.caseDensity),
    ]);

  // Load in GeoJSON data
  d3.json('us-states.json')
    .then((jsn) => {
      const json = jsn;

      for (let i = 0; i < data.length; i += 1) {
        const dataState = data[i].state;
        const dataValue = parseFloat(data[i].metrics.caseDensity);

        // Find the corresponding state inside the GeoJSON
        for (let j = 0; j < json.features.length; j += 1) {
          const jsonState = json.features[j].properties.name;
          if (dataState === jsonState) {
            json.features[j].properties.value = dataValue;
            json.features[j].properties.detail = data[i];
            json.features[j].color = `hsl(40, 100%, ${color(dataValue)}%)`;
            break;
          }
        }
      }
      // Bind data and create one path per GeoJSON feature
      plot.append('g')
        .classed('states', true)
        .selectAll('path')
        .data(json.features)
        .enter()
        .append('path')
        .attr('class', (d) => `s${d.properties.detail.fips} fill`)
        .attr('d', path)
        .attr('stroke', 'grey')
        .attr('stroke-width', 0.15)
        .attr('stroke-opacity', 0.6)
        .attr('fill', (d) => {
          // Get data value
          const { value } = d.properties;
          if (value) {
            return d.color;
          }
          return 'grey';
        })
        // eslint-disable-next-line no-use-before-define
        .on('mouseover', (e, d) => onHover(d.properties.detail))
        // eslint-disable-next-line no-use-before-define
        .on('mouseout', (e, d) => outHover(d.properties.detail))
        // eslint-disable-next-line no-use-before-define
        .on('click', (e, d) => onClick(d.properties.detail))
        .append('title')
        .text((d) => `${d.properties.name}\n Case Density: ${d3.format('.2f')(d.properties.value)}`);
    });

  // create legend
  const samples = d3.quantize(d3.interpolate(
    d3.max(data, (d) => d.metrics.caseDensity), d3.min(data, (d) => d.metrics.caseDensity),
  ), 50);
  const legendScale = d3.scaleLinear()
    .domain([
      d3.max(data, (d) => d.metrics.caseDensity),
      d3.min(data, (d) => d.metrics.caseDensity),
    ])
    .range([0, 3 * samples.length]);
  const legend = plot.append('g').classed('legend', true)
    .attr('transform', `translate(${w - 100} 100)`);
  legend.selectAll('.legend_bar').data(samples)
    .enter()
    .append('rect')
    .classed('legend_bar', true)
    .attr('x', 0)
    .attr('y', (d, i) => i * 3)
    .attr('width', 10)
    .attr('height', 3)
    .attr('fill', (d) => `hsl(40, 100%, ${color(d)}%)`);
  legend.append('g').classed('axes', true).call(d3.axisRight(legendScale))
    .attr('transform', 'translate(10, 0)');
  legend.append('text').text('cases/100k pop')
    .attr('y', 3 * samples.length + 20);
}

/*
 Heatmap for risk levels
*/
function plotHeat(stateData, padding) {
  const plot = d3.select('#plot_heat');

  const w = plot.node().clientWidth;
  const h = plot.node().clientHeight;

  const colors = ['grey', '#fef0d9', '#fdcc8a', '#fc8d59', '#e34a33', '#b30000'];
  const color = d3.scaleOrdinal([4, 0, 1, 2, 3, 5], colors);
  const levels = ['Low', 'Medium', 'High', 'Critical', 'Unknown', 'Extreme'];
  const data = [
    ['Overall', stateData.riskLevels.overall],
    ['Test positivity ratio', stateData.riskLevels.testPositivityRatio],
    ['Case density', stateData.riskLevels.caseDensity],
    ['Infection rate', stateData.riskLevels.infectionRate],
    ['Contact tracer capacity ratio', stateData.riskLevels.contactTracerCapacityRatio],
    ['ICU headroom ratio', stateData.riskLevels.icuHeadroomRatio],
  ];

  const yScale = d3.scaleBand().padding(0.1)
    .domain(data.map((d) => d[0]))
    .range([padding, h - padding]);

  plot.selectAll('.block').data(data)
    .enter()
    .append('rect')
    .classed('block', true)
    .attr('x', w / 2 - padding)
    .attr('y', (d, i) => yScale(d[0]))
    .attr('width', yScale.bandwidth() * 2)
    .attr('height', yScale.bandwidth())
    .attr('fill', (d) => color(d[1]));

  plot.selectAll('legend_value').data(data)
    .enter()
    .append('text')
    .classed('legend_value', true)
    .attr('x', w / 2 - padding + yScale.bandwidth())
    .attr('y', (d, i) => yScale(d[0]) + yScale.bandwidth() / 2)
    .text((d) => levels[d[1]]);

  const yAxis = d3.axisLeft(yScale);
  plot.append('g').classed('axes', true).call(yAxis)
    .attr('transform', `translate(${w / 2 - padding} 0)`);

  plot.append('text')
    .classed('title', true)
    .attr('dominant-baseline', 'hanging')
    .attr('text-anchor', 'middle')
    .attr('transform', `translate(${w / 2 - padding} 0)`)
    .text(`${stateData.state}'s risk level`);
}

function updateHeat(stateData) {
  const plot = d3.select('#plot_heat');

  const colors = ['grey', '#fef0d9', '#fdcc8a', '#fc8d59', '#e34a33', '#b30000'];
  const color = d3.scaleOrdinal([4, 0, 1, 2, 3, 5], colors);
  const levels = ['Low', 'Medium', 'High', 'Critical', 'Unknown', 'Extreme'];
  const data = [
    ['Overall', stateData.riskLevels.overall],
    ['Test positivity ratio', stateData.riskLevels.testPositivityRatio],
    ['Case density', stateData.riskLevels.caseDensity],
    ['Infection rate', stateData.riskLevels.infectionRate],
    ['Contact tracer capacity ratio', stateData.riskLevels.contactTracerCapacityRatio],
    ['ICU headroom ratio', stateData.riskLevels.icuHeadroomRatio],
  ];

  plot.selectAll('.block')
    .data(data)
    .transition()
    .duration(500)
    .attr('fill', (d) => color(d[1]));

  plot.selectAll('.legend_value')
    .data(data)
    .text((d) => levels[d[1]]);

  plot.select('.title')
    .text(`${stateData.state}'s risk level`);
}

/*
 Bar chart for actuals data
*/
function updateBar(rawData, padding) {
  const plot = d3.select('#plot_bar');

  const w = plot.node().clientWidth;
  const h = plot.node().clientHeight;

  const color = d3.scaleOrdinal(['cases', 'deaths', 'newCases'], ['orange', 'red', 'DarkOrange']);

  const type = barType;
  const data = rawData;
  data.sort((a, b) => b.actuals[type] - a.actuals[type]);
  data.forEach((e) => { e.color = color(type); });

  const yScale = d3.scaleLinear()
    .domain([0, d3.max(data, (d) => d.actuals[type])])
    .range([h - padding, padding / 2]);
  const xScale = d3.scaleBand().padding(0.5)
    .domain(data.map((d) => d.state))
    .range([padding, w - padding]);

  const bars = plot.selectAll('.bar').data(data);

  const newBars = bars
    .enter()
    .append('rect')
    .attr('x', w)
    .attr('y', (d, i) => yScale(d.actuals[type]))
    .attr('width', xScale.bandwidth())
    .attr('height', (d) => h - yScale(d.actuals[type]) - padding);

  newBars
    .append('title')
    .text((d) => `${d.state}\n # of ${type}: ${d3.format('.0f')(d.actuals[type])}`);

  newBars
    .merge(bars)
    .attr('class', (d) => `s${d.fips} fill`)
    .classed('bar', true)
    .attr('fill', (d) => d.color)
    // eslint-disable-next-line no-use-before-define
    .on('mouseover', (e, d) => onHover(d))
    // eslint-disable-next-line no-use-before-define
    .on('mouseout', (e, d) => outHover(d))
    .transition()
    .duration(1000)
    .attr('x', (d) => xScale(d.state))
    .attr('y', (d, i) => yScale(d.actuals[type]))
    .attr('width', xScale.bandwidth())
    .attr('height', (d) => h - yScale(d.actuals[type]) - padding);

  bars.exit().transition().duration(1000).attr('x', w)
    .remove();

  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3.axisLeft(yScale);
  plot.select('.x.axes').transition().duration(1000).call(xAxis)
    .selectAll('text')
    .attr('y', 0)
    .attr('x', 9)
    .attr('transform', 'rotate(70)')
    .attr('font-style', 'italic')
    .attr('font-size', '80%')
    .style('text-anchor', 'start');
  plot.select('.y.axes').transition().duration(1000).call(yAxis);

  plot.select('.title')
    .text(`Actual number of ${type}`);
}

function plotBar(rawData, padding) {
  const plot = d3.select('#plot_bar');

  const w = plot.node().clientWidth;
  const h = plot.node().clientHeight;

  const type = barType;

  const data = rawData;

  const yScale = d3.scaleLinear()
    .domain([0, d3.max(data, (d) => d.actuals[type])])
    .range([h - padding, padding / 2]);
  const xScale = d3.scaleBand().padding(0.5)
    .domain(data.map((d) => d.state))
    .range([padding, w - padding]);

  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3.axisLeft(yScale);
  plot.append('g').classed('axes', true).classed('x', true).call(xAxis)
    .attr('transform', `translate(0 ${h - padding})`)
    .selectAll('text')
    .attr('y', 0)
    .attr('x', 9)
    .attr('transform', 'rotate(70)')
    .attr('font-style', 'italic')
    .attr('font-size', '80%')
    .style('text-anchor', 'start');
  plot.append('g').classed('axes', true).classed('y', true).call(yAxis)
    .attr('transform', `translate(${padding} 0)`);

  plot.append('text')
    .classed('title', true)
    .attr('dominant-baseline', 'hanging')
    .attr('text-anchor', 'middle')
    .attr('transform', `translate(${w / 2} 0)`)
    .text(`Actual number of ${type}`);
  updateBar(rawData, padding);
}

/*
  Line chart for prjected case density
*/
function updateLine(rawData, padding) {
  const plot = d3.select('#plot_line');

  const w = plot.node().clientWidth;
  const h = plot.node().clientHeight;

  const data = rawData;
  data.forEach((e) => { e.lineColor = 'orange'; });

  const yScale = d3.scaleLinear()
    .domain([
      d3.min(data, (d) => d3.min(d.projectDensity)),
      d3.max(data, (d) => d3.max(d.projectDensity)),
    ])
    .range([h - padding, padding / 2]);
  const xScale = d3.scaleLinear()
    .domain([0, 14])
    .range([padding, w - padding]);

  const lines = plot.selectAll('.line').data(data);

  const line = d3.line()
    .x((d, i) => xScale(i))
    .y((d, i) => yScale(d));

  const newLines = lines
    .enter()
    .append('path');

  newLines
    .append('title')
    .text((d) => `${d.state}`)
    .attr('stroke-width', 0);

  const allLines = newLines.merge(lines);

  allLines
    .datum((d) => d.projectDensity)
    .attr('fill', 'none')
    .transition()
    .duration(1000)
    .attr('d', line)
    .attr('stroke-opacity', 0.8)
    .attr('stroke-width', 3);

  allLines.data(data)
    .attr('class', (d) => `s${d.fips}`)
    .classed('line', true)
    // eslint-disable-next-line no-use-before-define
    .on('mouseover', (e, d) => onHover(d))
    // eslint-disable-next-line no-use-before-define
    .on('mouseout', (e, d) => outHover(d))
    .attr('stroke', (d) => d.lineColor)
    .select('title')
    .text((d) => d.state);

  const labels = plot.selectAll('.state_label').data(data);

  const newLabels = labels
    .enter()
    .append('text');

  labels.merge(newLabels)
    .attr('fill', (d) => d.lineColor)
    .attr('opacity', 0.8)
    .attr('class', (d) => `s${d.fips} state_label`)
    .transition()
    .duration(1000)
    .text((d) => d.state)
    .attr('y', (d) => yScale(d.projectDensity[14]))
    .attr('x', (d) => xScale(14.1))
    .attr('dominant-baseline', 'middle');

  labels.merge(newLabels)
    // eslint-disable-next-line no-use-before-define
    .on('mouseover', (e, d) => onHover(d))
    // eslint-disable-next-line no-use-before-define
    .on('mouseout', (e, d) => outHover(d));

  labels.exit().remove();

  lines.exit().transition().duration(1000).attr('stroke-width', 0)
    .remove();

  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3.axisLeft(yScale);
  plot.select('.x.axes').transition().duration(1000).call(xAxis);
  plot.select('.y.axes').transition().duration(1000).call(yAxis);
}

function plotLine(rawData, padding) {
  const plot = d3.select('#plot_line');

  const w = plot.node().clientWidth;
  const h = plot.node().clientHeight;

  const data = rawData;

  const yScale = d3.scaleLinear()
    .domain([
      d3.min(data, (d) => d3.min(d.projectDensity)),
      d3.max(data, (d) => d3.max(d.projectDensity)),
    ])
    .range([h - padding, padding / 2]);
  const xScale = d3.scaleLinear()
    .domain([0, 14])
    .range([padding, w - padding]);

  const xAxis = d3.axisBottom(xScale);
  const yAxis = d3.axisLeft(yScale);
  plot.append('g').classed('axes', true).classed('x', true).call(xAxis)
    .attr('transform', `translate(0 ${h - padding})`);
  plot.append('g').classed('axes', true).classed('y', true).call(yAxis)
    .attr('transform', `translate(${padding} 0)`);

  plot.append('text')
    .classed('title', true)
    .attr('dominant-baseline', 'hanging')
    .attr('text-anchor', 'middle')
    .attr('transform', `translate(${w / 2} 0)`)
    .text('Projected case densities after 14 days');
  updateLine(rawData, padding);
}

/*
  Interactions
*/
function toggleSelection() {
  if (selectState.length === covidData.length) {
    selectState = [];
    d3.select('#plot_geo').selectAll('.states path')
      .attr('stroke', 'white')
      .attr('stroke-width', 0.15)
      .attr('stroke-opacity', 0.6);
  } else {
    selectState = covidData;
    d3.select('#plot_geo').selectAll('.states path')
      .attr('stroke', 'LimeGreen')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.9);
  }
  updateBar(selectState, 100);
  updateLine(selectState, 100);
}

function onHover(stateData) {
  hoverState = stateData;
  d3.selectAll(`.s${hoverState.fips}.fill`)
    .attr('fill', '#33CEFF');
  d3.selectAll('.line')
    .attr('opacity', 0.2);
  d3.selectAll('.state_label')
    .attr('opacity', 0.2)
    .attr('font-weight', 'bolder');
  d3.selectAll(`.s${hoverState.fips}.line`)
    .attr('stroke', '#33CEFF')
    .attr('opacity', 1);
  d3.selectAll(`.s${hoverState.fips}.state_label`)
    .attr('fill', '#33CEFF')
    .attr('opacity', 1);
  updateHeat(hoverState);
}

function outHover(stateData) {
  hoverState = stateData;
  d3.selectAll(`.s${hoverState.fips}.fill`)
    .attr('fill', (d) => d.color);
  d3.selectAll(`.s${hoverState.fips}.line`)
    .attr('stroke', (d) => d.lineColor);
  d3.selectAll(`.s${hoverState.fips}.state_label`)
    .attr('fill', (d) => d.lineColor);
  d3.selectAll('.line')
    .attr('opacity', 0.8);
  d3.selectAll('.state_label')
    .attr('opacity', 0.8)
    .attr('font-weight', 'normal');
}

function onClick(stateData) {
  if (selectState.includes(stateData)) {
    selectState = selectState.filter((e) => e.fips !== stateData.fips);
    d3.select('#plot_geo').selectAll(`.s${stateData.fips}`)
      .attr('stroke', 'white')
      .attr('stroke-width', 0.15)
      .attr('stroke-opacity', 0.6);
  } else {
    selectState.push(stateData);
    d3.select('#plot_geo').selectAll(`.s${stateData.fips}`)
      .attr('stroke', 'LimeGreen')
      .attr('stroke-width', 2)
      .attr('stroke-opacity', 0.9);
  }
  updateBar(selectState, 100);
  updateLine(selectState, 100);
  onHover(stateData);
}

/*
  run
*/
function createGraph(data) {
  covidData = data;
  covidData.forEach((e) => { e.projectDensity = projectDensity(e); });
  console.log(covidData);
  plotGeo(covidData, onHover, outHover, onClick);
  plotHeat(covidData[0], 60);
  plotBar(selectState, 100);
  plotLine(selectState, 100);

  d3.select('#selectAll').on('click', toggleSelection);
  d3.selectAll('#barTypeSelector input').on('click', (e) => {
    barType = e.target.value;
    updateBar(selectState, 100);
  });
}

d3.json('state_code.json')
  .then((data) => StateCodeToName(data))
  .then((data) => updateCovidData(data))
  .then(createGraph);
