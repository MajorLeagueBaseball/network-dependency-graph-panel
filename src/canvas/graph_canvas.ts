import _ from 'lodash';
import { NetworkDependencyGraphCtrl } from '../network_dependency_graph_ctrl';
import ParticleEngine from './particle_engine';
import { CyCanvas, IGraphMetrics, Particle, EGraphNodeType, Particles } from '../types';
import humanFormat from 'human-format';

export class CanvasDrawer {

  readonly colors = {
    default: '#bad5ed',
    background: '#212121',
    edge: '#505050',
    status: {
      warning: 'orange',
      error: 'red'
    }
  };

  readonly donutRadius: number = 15;

  controller: NetworkDependencyGraphCtrl;

  cytoscape: cytoscape.Core;

  context: CanvasRenderingContext2D;

  cyCanvas: CyCanvas;

  canvas: HTMLCanvasElement;

  offscreenCanvas: HTMLCanvasElement;

  offscreenContext: CanvasRenderingContext2D;

  frameCounter: number = 0;

  fpsCounter: number = 0;

  particleImage: HTMLImageElement;

  pixelRatio: number;

  imageAssets = {};

  selectionNeighborhood: cytoscape.Collection;

  particleEngine: ParticleEngine;

  lastRenderTime: number = 0;

  dashAnimationOffset: number = 0;

  timeScale: any;

  constructor(ctrl: NetworkDependencyGraphCtrl, cy: cytoscape.Core, cyCanvas: CyCanvas) {
    this.cytoscape = cy;
    this.cyCanvas = cyCanvas;
    this.controller = ctrl;
    this.particleEngine = new ParticleEngine(this);

    this.pixelRatio = window.devicePixelRatio || 1;

    this.canvas = cyCanvas.getCanvas();
    const ctx = this.canvas.getContext("2d");
    if (ctx) {
      this.context = ctx;
    } else {
      console.error("Could not get 2d canvas context.");
    }

    this.offscreenCanvas = document.createElement('canvas');
    this.offscreenContext = <CanvasRenderingContext2D>this.offscreenCanvas.getContext('2d');

    this.timeScale = new humanFormat.Scale({
      ms: 1,
      s: 1000,
      min: 60000
    });
  }

  resetAssets() {
    this.imageAssets = {};
  }

  _loadImage(imageUrl: string, assetName: string) {
    const that = this;

    const loadImage = (url, asset) => {
      const image = new Image();
      that.imageAssets[asset] = {
        image,
        loaded: false
      };

      return new Promise((resolve, reject) => {
        image.onload = () => resolve(asset);
        image.onerror = () => reject(new Error(`load ${url} fail`));
        image.src = url;
      });
    };
    loadImage(imageUrl, assetName)
      .then((asset: string) => {
        that.imageAssets[asset].loaded = true;
      });
  }

  _isImageLoaded(assetName: string) {
    if (_.has(this.imageAssets, assetName) && this.imageAssets[assetName].loaded) {
      return true;
    } else {
      return false;
    }
  }

  _getImageAsset(assetName, resolveName = true) {
    if (!_.has(this.imageAssets, assetName)) {
      const assetUrl = this.controller.getTypeSymbol(assetName, resolveName);
      this._loadImage(assetUrl, assetName);
    }

    if (this._isImageLoaded(assetName)) {
      return <HTMLImageElement>this.imageAssets[assetName].image;
    } else {
      return null;
    }
  }

  _getAsset(assetName, relativeUrl) {
    if (!_.has(this.imageAssets, assetName)) {
      const assetUrl = this.controller.getAssetUrl(relativeUrl);
      this._loadImage(assetUrl, assetName);
    }

    if (this._isImageLoaded(assetName)) {
      return <HTMLImageElement>this.imageAssets[assetName].image;
    } else {
      return null;
    }
  }

  start() {
    console.log("Starting graph logic");

    const that = this;
    const repaintWrapper = () => {
      that.repaint();
      window.requestAnimationFrame(repaintWrapper);
    }

    window.requestAnimationFrame(repaintWrapper);

    setInterval(() => {
      that.fpsCounter = that.frameCounter;
      that.frameCounter = 0;
    }, 1000);
  }

  startAnimation() {
    this.particleEngine.start();
  }

  stopAnimation() {
    this.particleEngine.stop();
  }

  _skipFrame() {
    const now = Date.now();
    const elapsedTime = now - this.lastRenderTime;

    if (this.particleEngine.count() > 0) {
      return false;
    }

    if (!this.controller.panel.settings.animate && elapsedTime < 1000) {
      return true;
    }
    return false;

  }

  repaint(forceRepaint: boolean = false) {
    if (!forceRepaint && this._skipFrame()) {
      return;
    }
    this.lastRenderTime = Date.now();

    const ctx = this.context;
    const cyCanvas = this.cyCanvas;
    const offscreenCanvas = this.offscreenCanvas;
    const offscreenContext = this.offscreenContext;

    offscreenCanvas.width = this.canvas.width;
    offscreenCanvas.height = this.canvas.height;

    // offscreen rendering
    this._setTransformation(offscreenContext);

    this.selectionNeighborhood = this.cytoscape.collection();
    const selection = this.cytoscape.$(':selected');
    selection.forEach((element: cytoscape.SingularElementArgument) => {
      this.selectionNeighborhood.merge(element);

      if (element.isNode()) {
        const neighborhood = element.neighborhood();
        this.selectionNeighborhood.merge(neighborhood);
      } else {
        const source = element.source();
        const target = element.target();
        this.selectionNeighborhood.merge(source);
        this.selectionNeighborhood.merge(target);
      }
    });

    this._drawEdgeAnimation(offscreenContext);
    this._drawNodes(offscreenContext);

    // static element rendering
    // cyCanvas.resetTransform(ctx);
    cyCanvas.clear(ctx);

    if (this.controller.getSettings().showDebugInformation) {
      this._drawDebugInformation();
    }

    if (offscreenCanvas.width > 0 && offscreenCanvas.height > 0) {
      ctx.drawImage(offscreenCanvas, 0, 0);
    }

    // baseline animation
    this.dashAnimationOffset = (Date.now() % 60000) / 250;
  }

  _setTransformation(ctx: CanvasRenderingContext2D) {
    const pan = this.cytoscape.pan();
    const zoom = this.cytoscape.zoom();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.translate(pan.x * this.pixelRatio, pan.y * this.pixelRatio);
    ctx.scale(zoom * this.pixelRatio, zoom * this.pixelRatio);
  }

  _drawEdgeAnimation(ctx: CanvasRenderingContext2D) {
    const now = Date.now();

    ctx.save();

    const edges = this.cytoscape.edges().toArray();
    const hasSelection = this.selectionNeighborhood.size() > 0;

    const transparentEdges = edges.filter(edge => hasSelection && !this.selectionNeighborhood.has(edge));
    const opaqueEdges = edges.filter(edge => !hasSelection || this.selectionNeighborhood.has(edge));

    ctx.globalAlpha = 0.25;
    this._drawEdges(ctx, transparentEdges, now)
    ctx.globalAlpha = 1;
    this._drawEdges(ctx, opaqueEdges, now)
    ctx.restore();
  }

  _drawEdges(ctx: CanvasRenderingContext2D, edges: Array<cytoscape.EdgeSingular>, now: number) {
    const cy = this.cytoscape;

    for(const edge of edges) {
      const sourcePoint = edge.sourceEndpoint();
      const targetPoint = edge.targetEndpoint();
      this._drawEdgeLine(ctx, edge, sourcePoint, targetPoint);
      this._drawEdgeParticles(ctx, edge, sourcePoint, targetPoint, now);
    }
    
    const { showConnectionStats } = this.controller.getSettings();
    if (showConnectionStats && cy.zoom() > 1) {
      for(const edge of edges) {
        this._drawEdgeLabel(ctx, edge);
      }
    }
  }

  _drawEdgeLine(ctx: CanvasRenderingContext2D, edge: cytoscape.EdgeSingular, sourcePoint: cytoscape.Position, targetPoint: cytoscape.Position) {
    ctx.beginPath();

    ctx.moveTo(sourcePoint.x, sourcePoint.y);

    const metrics = edge.data('metrics');
    const bps = _.get(metrics, 'bps', -1);
    const eps = _.get(metrics, 'eps', -1);

    const dir = edge.data('direction');
    if (dir === 'in') {
      ctx.bezierCurveTo(sourcePoint.x, sourcePoint.y - 20, targetPoint.x, targetPoint.y - 20, targetPoint.x, targetPoint.y);
    } else {
      ctx.bezierCurveTo(sourcePoint.x, sourcePoint.y + 20, targetPoint.x, targetPoint.y + 20, targetPoint.x, targetPoint.y);
    }

    let base;
    if (!this.selectionNeighborhood.empty() && this.selectionNeighborhood.has(edge)) {
      ctx.lineWidth = 3;
      base = 140;
    } else {
      ctx.lineWidth = 1;
      base = 80;
    }

    if (bps >= 0 && eps >= 0) {
      const range = 255;

      const factor = eps / bps;
      const color = Math.min(255, base + range * Math.log2(factor + 1));

      ctx.strokeStyle = 'rgb(' + color + ',' + base + ',' + base + ')';
    } else {
      ctx.strokeStyle = 'rgb(' + base + ',' + base + ',' + base + ')';
    }

    ctx.stroke();
  }

  _drawEdgeLabel(ctx: CanvasRenderingContext2D, edge: cytoscape.EdgeSingular) {
    const sourcePoint = edge.sourceEndpoint();
    const targetPoint = edge.targetEndpoint();

    let midpoint = {};
    const metrics: IGraphMetrics = edge.data('metrics');
    const bps = _.defaultTo(metrics.bps, -1);
    const eps = _.defaultTo(metrics.eps, -1);
    const dir = edge.data('direction');

    if (dir === 'in') {
      midpoint = this._bezierPoint(0.5, sourcePoint, {x: sourcePoint.x, y: sourcePoint.y - 20}, {x: targetPoint.x, y: targetPoint.y - 20}, targetPoint);
    } else {
      midpoint = this._bezierPoint(0.5, sourcePoint, {x: sourcePoint.x, y: sourcePoint.y + 20}, {x: targetPoint.x, y: targetPoint.y + 20}, targetPoint);
    }

    let statistics: string[] = [];

    this._drawInterfaceName(ctx, metrics.if_name, sourcePoint.x, sourcePoint.y, midpoint.x, midpoint.y, eps);
    this._drawInterfaceName(ctx, metrics.peer_if_name, targetPoint.x, targetPoint.y, midpoint.x, midpoint.y, eps);

    if (bps >= 0) {
      const decimals = bps >= 1000 ? 1 : 0;
      statistics.push(humanFormat(bps, { decimals }) + ' bps');
    }
    if (eps >= 0) {
      const decimals = eps >= 1000 ? 1 : 0;
      statistics.push(humanFormat(eps, { decimals }) + ' eps');
    }

    if (statistics.length > 0) {
      const edgeLabel = statistics.join(', ');
      this._drawLabel(ctx, edgeLabel, midpoint.x, midpoint.y);
    }
  }

  _drawEdgeParticles(ctx: CanvasRenderingContext2D, edge: cytoscape.EdgeSingular, sourcePoint: cytoscape.Position, targetPoint: cytoscape.Position, now: number) {
    const particles: Particles = edge.data('particles');

    if (particles === undefined) {
      return;
    }

    const dir = edge.data('direction');
    const metrics = edge.data('metrics');
    const bw = metrics.bps;
    const pps = metrics.pps;
    const drawContext = {
      ctx,
      now,
      sourcePoint,
      targetPoint,
      dir,
      bw,
      pps,
    };

    // normal particles
    ctx.beginPath();

    let index = particles.normal.length - 1;
    while (index >= 0) {
      this._drawParticle(drawContext, particles.normal, index);
      index--;
    }

    ctx.fillStyle = '#d1e2f2';
    ctx.fill();

    // danger particles
    ctx.beginPath();

    index = particles.danger.length - 1;
    while (index >= 0) {
      this._drawParticle(drawContext, particles.danger, index);
      index--;
    }

    const dangerColor = this.controller.getSettings().style.dangerColor;
    ctx.fillStyle = dangerColor;
    ctx.fill();
  }

  _drawLabel(ctx: CanvasRenderingContext2D, label: string, cX: number, cY: number) {
    const labelPadding = 1;
    ctx.font = '6px Arial';

    const labelWidth = ctx.measureText(label).width;
    const xPos = cX - labelWidth / 2;
    const yPos = cY + 3;

    ctx.fillStyle = this.colors.default;
    ctx.fillRect(xPos - labelPadding, yPos - 6 - labelPadding, labelWidth + 2 * labelPadding, 6 + 2 * labelPadding);

    ctx.fillStyle = this.colors.background;
    ctx.fillText(label, xPos, yPos);
  }

  _drawInterfaceName(ctx: CanvasRenderingContext2D, if_name: string, cX: number, cY: number, midX: number, midY: number, eps: number) {
    const labelPadding = 1;
    ctx.font = '4px Arial';

    const labelWidth = ctx.measureText(if_name).width;
    // let xPos = cX;
    // let yPos = cY + 2;

    const xVector = midX - cX;
    const yVector = midY - cY;

    const angle = Math.atan2(yVector, xVector);
    const xDirection = Math.cos(angle);
    const yDirection = Math.sin(angle);

    let xPos = cX + (xDirection * labelWidth);
    let yPos = cY + (yDirection * labelWidth);

    if (cX > midX) {
      // we need to move the label towards the midpoint by *subtracting* labelWidth
      // to cX
      xPos = xPos - (labelWidth);
    }

    if (eps <= 0) {
      ctx.fillStyle = this.colors.default;
    } else {
      ctx.fillStyle = this.colors.status.error;
    }
    ctx.fillRect(xPos - labelPadding, yPos - 4 - labelPadding, labelWidth + 2 * labelPadding, 4 + 2 * labelPadding);

    ctx.fillStyle = this.colors.background;
    ctx.fillText(if_name, xPos, yPos);
  }

  _bezierPoint(pointOnLine: number,
               p0: cytoscape.Position,
               p1: cytoscape.Position,
               p2: cytoscape.Position,
               p3: cytoscape.Position)
  {
    var cX = 3 * (p1.x - p0.x),
    bX = 3 * (p2.x - p1.x) - cX,
    aX = p3.x - p0.x - cX - bX;

    var cY = 3 * (p1.y - p0.y),
    bY = 3 * (p2.y - p1.y) - cY,
    aY = p3.y - p0.y - cY - bY;

    var x = (aX * Math.pow(pointOnLine, 3)) + (bX * Math.pow(pointOnLine, 2)) + (cX * pointOnLine) + p0.x;
    var y = (aY * Math.pow(pointOnLine, 3)) + (bY * Math.pow(pointOnLine, 2)) + (cY * pointOnLine) + p0.y;

    return {x: x, y: y};
  }

  _drawParticle(drawCtx, particles: Particle[], index: number) {
    const { ctx,
            now,
            sourcePoint,
            targetPoint,
            dir,
            bw,
            pps,
          } = drawCtx;

    const particle = particles[index];

    const timeDelta = now - particle.startTime;
    const t = timeDelta * particle.velocity;
    let point = {};
    if (dir === 'in') {
      point = this._bezierPoint(t, targetPoint, {x: targetPoint.x, y: targetPoint.y - 20}, {x: sourcePoint.x, y: sourcePoint.y - 20}, sourcePoint);
    } else {
      point = this._bezierPoint(t, sourcePoint, {x: sourcePoint.x, y: sourcePoint.y + 20}, {x: targetPoint.x, y: targetPoint.y + 20}, targetPoint);
    }

    const xPos = point.x;
    const yPos = point.y;

    // if t > 1 we have left the bezier curve
    if (t > 1) {
      // remove particle
      particles.splice(index, 1);
    } else {
      // draw particle
      ctx.moveTo(xPos, yPos);
      const r = bw/pps;
      let radius = 1;
      if (r >= 6000 && r < 12000) {
        radius = 2;
      } else if (r >= 12000 && r < 25000) {
        radius = 4;
      } else if (r >= 25000 && r < 50000) {
        radius = 6;
      } else if (r >= 50000) {
        radius = 10;
      }

      ctx.arc(xPos, yPos, radius, 0, 2 * Math.PI, false);
    }
  }

  _drawNodes(ctx: CanvasRenderingContext2D) {
    const that = this;
    const cy = this.cytoscape;

    // Draw model elements
    const nodes = cy.nodes().toArray();
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      if (that.selectionNeighborhood.empty() || that.selectionNeighborhood.has(node)) {
        ctx.globalAlpha = 1;
      } else {
        ctx.globalAlpha = 0.25;
      }

      // draw the node
      that._drawNode(ctx, node);

      // drawing the node label in case we are not zoomed out
      if (cy.zoom() > 1) {
        that._drawNodeLabel(ctx, node);
      }
    }
  }

  _drawNode(ctx: CanvasRenderingContext2D, node: cytoscape.NodeSingular) {
    const cy = this.cytoscape;
    const type = node.data('type');
    const metrics: IGraphMetrics = node.data('metrics');

    if (type === EGraphNodeType.INTERNAL) {
      const bps = _.defaultTo(metrics.bps, -1);
      const eps = _.defaultTo(metrics.eps, 0);
      const pps = _.defaultTo(metrics.pps, 0);

      let healthyPct = 1;
      let errorPct = 0;
      let unknownPct = 0;
      if (bps < 0) {
        healthyPct = 0;
        errorPct = 0;
        unknownPct = 1;
      } else {
        if (eps <= 0) {
          errorPct = 0.0;
        } else {
          errorPct = eps / pps;
        }
        healthyPct = 1.0 - errorPct;
        unknownPct = 0;
      }

      // drawing the donut
      this._drawDonut(ctx, node, 15, 5, 0.5, [errorPct, unknownPct, healthyPct])

      // drawing the baseline status
      const showBaselines = this.controller.getSettings().showBaselines;
      this._drawServiceIcon(ctx, node);
    } else {
      this._drawExternalService(ctx, node);
    }

    // draw statistics
    if (cy.zoom() > 1) {
      this._drawNodeStatistics(ctx, node);
    }
  }

  _drawServiceIcon(ctx: CanvasRenderingContext2D, node: cytoscape.NodeSingular) {
    const nodeId: string = node.id();

    const iconMappings = this.controller.panel.settings.serviceIcons;

    const mapping = _.find(iconMappings, ({ pattern }) => {
      try {
        return new RegExp(pattern).test(nodeId);
      } catch (error) {
        return false;
      }
    });

    if (mapping) {
      const image = this._getAsset(mapping.filename, 'service_icons/' + mapping.filename + '.png');
      if (image != null) {
        const cX = node.position().x;
        const cY = node.position().y;
        const iconSize = 16;

        ctx.drawImage(image, cX - iconSize / 2, cY - iconSize / 2, iconSize, iconSize);
      }
    }
  }

  _drawNodeStatistics(ctx: CanvasRenderingContext2D, node: cytoscape.NodeSingular) {
    // const lines: string[] = [];

    // const metrics: IGraphMetrics = node.data('metrics');
    // const bytesIn = _.defaultTo(metrics.rate, -1);
    // const errorCount = _.defaultTo(metrics.error_rate, -1);
    // const responseTime = _.defaultTo(metrics.response_time, -1);

    // if (bytesIn >= 0) {
    //     const decimals = bytesIn >= 1000 ? 1 : 0;
    //     lines.push('Bytes in: ' + humanFormat(bytesIn, { decimals }));
    // }
    // if (errorCount >= 0) {
    //     const decimals = errorCount >= 1000 ? 1 : 0;
    //     lines.push('Errors: ' + humanFormat(errorCount, { decimals }));
    // }
    // if (responseTime >= 0) {
    //     const decimals = responseTime >= 1000 ? 1 : 0;
    //     lines.push('Avg. Resp. Time: ' + humanFormat(responseTime, { scale: this.timeScale, decimals }));
    // }

    // const pos = node.position();
    // const fontSize = 4;
    // const cX = pos.x + this.donutRadius * 1.25;
    // const cY = pos.y + fontSize / 2 - (fontSize / 2) * (lines.length - 1);

    // ctx.font = '6px Arial';
    // ctx.fillStyle = this.colors.default;
    // for (let i = 0; i < lines.length; i++) {
    //     ctx.fillText(lines[i], cX, cY + i * fontSize);
    // }
  }

  _drawThresholdStroke(ctx: CanvasRenderingContext2D, node: cytoscape.NodeSingular, violation: boolean, radius: number, width: number, baseStrokeWidth: number) {
    const pos = node.position();
    const cX = pos.x;
    const cY = pos.y;

    const strokeWidth = baseStrokeWidth * 2 * (violation ? 1.5 : 1);
    const offset = strokeWidth * 0.2;

    ctx.beginPath();
    ctx.arc(cX, cY, radius + strokeWidth - offset, 0, 2 * Math.PI, false);
    ctx.closePath();
    ctx.setLineDash([]);
    ctx.lineWidth = strokeWidth * 1;
    ctx.strokeStyle = 'white';
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(cX, cY, radius + strokeWidth - offset, 0, 2 * Math.PI, false);
    ctx.closePath();

    ctx.setLineDash([10, 2]);
    if (violation && this.controller.panel.settings.animate) {
      ctx.lineDashOffset = this.dashAnimationOffset;
    } else {
      ctx.lineDashOffset = 0;
    }
    ctx.lineWidth = strokeWidth;
    ctx.strokeStyle = violation ? 'rgb(184, 36, 36)' : '#37872d';

    ctx.stroke();

    // inner
    ctx.beginPath();
    ctx.arc(cX, cY, radius - width - baseStrokeWidth, 0, 2 * Math.PI, false);
    ctx.closePath();
    ctx.fillStyle = violation ? 'rgb(184, 36, 36)' : '#37872d';
    ctx.fill();
  }

  _drawExternalService(ctx: CanvasRenderingContext2D, node: cytoscape.NodeSingular) {
    const pos = node.position();
    const cX = pos.x;
    const cY = pos.y;
    const size = 12;

    ctx.beginPath();
    ctx.arc(cX, cY, 12, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'white';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(cX, cY, 11.5, 0, 2 * Math.PI, false);
    ctx.fillStyle = this.colors.background;
    ctx.fill();

    const nodeType = node.data('external_type');

    const image = this._getImageAsset(nodeType);
    if (image != null) {
      ctx.drawImage(image, cX - size / 2, cY - size / 2, size, size);
    }
  }

  _drawNodeLabel(ctx: CanvasRenderingContext2D, node: cytoscape.NodeSingular) {
    const pos = node.position();
    let label: string = node.id();
    const labelPadding = 1;

    if (this.selectionNeighborhood.empty() || !this.selectionNeighborhood.has(node)) {
      if (label.length > 20) {
        label = label.substr(0, 7) + '...' + label.slice(-7);
      }
    }

    ctx.font = '6px Arial';

    const labelWidth = ctx.measureText(label).width;
    const xPos = pos.x - labelWidth / 2;
    const yPos = pos.y + node.height() * 0.8;

    const showBaselines = this.controller.getSettings().showBaselines;
    const metrics: IGraphMetrics = node.data('metrics');

    if (!showBaselines) {
      ctx.fillStyle = this.colors.default;
    } else {
      ctx.fillStyle = '#FF7383';
    }

    ctx.fillRect(xPos - labelPadding, yPos - 6 - labelPadding, labelWidth + 2 * labelPadding, 6 + 2 * labelPadding);

    ctx.fillStyle = this.colors.background;
    ctx.fillText(label, xPos, yPos);
  }

  _drawDebugInformation() {
    const ctx = this.context;

    this.frameCounter++;

    ctx.font = '12px monospace';
    ctx.fillStyle = 'white';
    ctx.fillText("Frames per Second: " + this.fpsCounter, 10, 12);
    ctx.fillText("Particles: " + this.particleEngine.count(), 10, 24);
  }

  _drawDonut(ctx: CanvasRenderingContext2D, node: cytoscape.NodeSingular, radius, width, strokeWidth, percentages) {
    const cX = node.position().x;
    const cY = node.position().y;

    let currentArc = -Math.PI / 2; // offset

    ctx.beginPath();
    ctx.arc(cX, cY, radius + strokeWidth, 0, 2 * Math.PI, false);
    ctx.closePath();
    ctx.fillStyle = 'white';
    ctx.fill();

    const { healthyColor, dangerColor, unknownColor } = this.controller.getSettings().style;
    const colors = [dangerColor, unknownColor, healthyColor];
    for (let i = 0; i < percentages.length; i++) {
      let arc = this._drawArc(ctx, currentArc, cX, cY, radius, percentages[i], colors[i]);
      currentArc += arc;
    }

    ctx.beginPath();
    ctx.arc(cX, cY, radius - width, 0, 2 * Math.PI, false);
    ctx.fillStyle = 'white';
    ctx.fill();

    // // cut out an inner-circle == donut
    ctx.beginPath();
    ctx.arc(cX, cY, radius - width - strokeWidth, 0, 2 * Math.PI, false);
    if (node.selected()) {
      ctx.fillStyle = 'white';
    } else {
      ctx.fillStyle = this.colors.background;
    }
    ctx.fill();
  }

  _drawArc(ctx: CanvasRenderingContext2D, currentArc, cX, cY, radius, percent, color) {
    // calc size of our wedge in radians
    var WedgeInRadians = percent * 360 * Math.PI / 180;
    // draw the wedge
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(cX, cY);
    ctx.arc(cX, cY, radius, currentArc, currentArc + WedgeInRadians, false);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.restore();
    // sum the size of all wedges so far
    // We will begin our next wedge at this sum
    return WedgeInRadians;
  }
};
