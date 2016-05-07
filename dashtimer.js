/**
 * @constructor DashTimer
 * uses D3 to plot circular timer
 * @param {object|string} div the container for the viz an element or #name
 */
function DashTimer(div) {
  var TAU = 2 * Math.PI,
    NAME = "DashTimer";

  var self = this,
    data_, dash_,
    dInfo_ = {},
    div_ = Object(div) === div ? '#' + div.id : div;

  /**
   * initialize the arc data
   * @param {[object]} data the array of data for each arc
   * @param {object} [options=] the viz options
   * @return {DashTimer} self
   */
  self.setData = function(data, options) {
    // first time in, set up the containers
    if (!dash_) {
      self.init(options)
    }
    // set up values for d3
    data_ = (data || [{}, {}]).map(function(d, i) {
      var m = vanMerge_([dash_, d]);
      m.index = i;
      m.startAngle = m.start.angle * TAU;
      m.endAngle = m.finish.angle * TAU;
      m.start.innerRadius = dash_.height / 2 * m.start.innerRatio;
      m.start.outerRadius = dash_.height / 2 * m.start.outerRatio;
      m.innerRadius = m.start.innerRadius;
      m.outerRadius = m.start.outerRadius;
      m.finish.innerRadius = dash_.height / 2 * m.finish.innerRatio;
      m.finish.outerRadius = dash_.height / 2 * m.finish.outerRatio;
      m.value = m.start.value;
      m.static = {
        endAngle: m.immediate.angle,
        innerRadius: m.finish.innerRadius === m.start.innerRadius,
        outerRadius: m.finish.outerRadius === m.start.outerRadius,
        value: m.start.value === m.finish.value
      };
      m.dataName = m.dataName || NAME + i;
      return m;
    });
    d3.select(div_).html("");
    dInfo_.arc = d3.svg.arc();
    dInfo_.svg = d3.select(div_).append("svg")
      .attr("width", dash_.width)
      .attr("height", dash_.height)
      .append("g")
      .attr("transform", "translate(" +
        dash_.width / 2 + "," + dash_.height / 2 + ")");


    dInfo_.textElements = dInfo_.svg.append("text");
    (dash_.values.styles.split(";") || []).forEach(function(d) {
      if (d) {
        var s = d.split(":");
        if (s.length !== 2) throw 'invalid style ' + d;
        dInfo_.textElements.style(s[0], s[1]);
      }
    });

    if (dash_.values.classes) {
      dash_.values.classes.split(" ").forEach(function(d) {
        if (d) dInfo_.textElements.classed(d, true);
      });
    }
    dash_.internal.cancelled = dash_.internal.paused= dash_.internal.finished= false;

    resetPromise_();
    
    return self;
  };

  /**
   * initialize the arcs
   * @param {object} options the viz options
   * @return {DashTimer} self
   */
  self.init = function(options) {

    // merge default settings with given
    dash_ = vanMerge_([{     // default settings - many can be overridden in data for individual items
      height: 100,           // height of viz
      width: 100,            // width of viz (since a circle both are equal)
      ease: "linear",        // type of easing (pause/resume will only work reliably with linear)
      duration: 5000,        // tranistion duration
      callback:"",           // function (d, self) to call back on every transition step
      name: NAME + new Date().getTime(), // name of dashtimer
      start: {               // values at start of transition
        innerRatio: .8,      // diameter of inner circle relative to height
        outerRatio: .95,      // diameter of outer circle relative to height
        angle: 0,            // angle between 0 and 1
        fill: '#2196F3',     // fill color
        value: 0             // value to interpolate
      },
      finish: {              // values at end of transition
        innerRatio: .8,      // diameter of inner circle relative to height
        outerRatio: .95,     // diameter of outer circle relative to height
        angle: 1,            // angle between 0 and 1
        fill: '#FFC107',     // fill color
        value: 100           // value to interpolate
      },
      immediate: {           // if true then transition is skipped
        angle:false,         // the angle
      },
      values: {              // things to do with displaying values 
        classes: "",         // classes to apply separated by spaces
        styles: "text-anchor:middle;", // styles to apply separated by ;
        show: false,         // whether to show values
        decorate: function(d) {  // function to clean up data before displaying
          return Math.round(d); 
        }
      },           
      custom:{},             // should be used for any custom data to be carried around
      internal:{
        paused:false,
        progress:0,
        finished:true
      }                 
    }, options || {}]);

    return self;
  };
  /**
   * causes the timer to resolve from outside
   * @return {DashTimer} self
   */
  self.resolve= function() {
    dash_.internal.paused = false;
    dash_.internal.finished = true;
    dash_.mp.resolve(self);
    return self;
  };
  /**
   * causes the timer to reject from outside
   * @return {DashTimer} self
   */
  self.reject = function() {
    dash_.internal.paused = false;
    dash_.internal.finished = true;
    dash_.mp.reject(self);
    return self;
  };
  
  /**
   * pauses the timer right now
   * timeout promise is not resolved or rejected
   * @return {DashTimer} self
   */
  self.pause = function() {
    if (self.isRunning()) {
      dash_.internal.paused = true;
      dInfo_.path.transition(dash_.name).duration(0);
    }
    return self;
  };
  
  /**
   * resumes at the last place paused at
   * if not paused, nothing happens
   * @return {Promise | null} a promise to th resumed run - not normally required
   */
  self.resume = function() {
    // this will return the master promise
    if (self.isPaused()) {
      return work_(
        dash_.internal.progress,
        dash_.internal.duration * (dash_.finishAt - dash_.internal.progress),
        dash_.finishAt
      );
    }
  };
     
  /**
  * kills any ongoing transition
  * does not fire any promises
  * @return {DashTimer} self
  */
  self.cancel = function() {
    
    //if there is oe on the go then kill it and reject the promise
    if (dash_.mp) {
      dash_.internal.cancelled = true;
      // this will cause a zero transition to cancel the current one
      dInfo_.path.transition(dash_.name).duration(0);
      self.reject();
    }

    
  }
   /**
   * start a new timer
   * @param {number} duration number of seconds to run he transition for
   * @param {[object]} [data=] replace the current data with this
   * @param {number} [start=0] start place
   * @param {number} [finish=1] finish place
   * @return {Promise} a promise that'll be resolved when it times out
   */
  self.start = function(duration,start,finish) {
    resetPromise_();
    dash_.internal.duration = fixDef_ (duration,dash_.duration);
    return work_(fixDef_ (start,0) , dash_.internal.duration, fixDef_ (finish,1));
  };
  
  /**
   * get the current data 
   * @return {[object]} the data
   */
  self.getData = function() {
    return data_;
  };
  /**
   * get the current data 
   * @param {string} dataName the data name
   * @return {object} the data
   */
  self.getItem = function(dataName) {
    return data_.reduce(function(p,c) {
      return c.dataName === dataName ? c : p;
    },null);
  };
  /**
   * get all the current control values
   * @return {object} the current control values
   */
  self.getControl = function() {
    return dash_;
  };
  /**
   * get all the current control values
   * @return {object} the current control values
   */
  self.getVizInfo = function() {
    return dInfo_;
  };
  /**
   * is the viz currenly paused
   * @return {boolean} is it paused
   */
  self.isPaused = function() {
    return dash_.internal.paused;
  };
  /**
   * is the viz currenly finished
   * @return {boolean} is it finished
   */
  self.isFinished = function() {
    return dash_.internal.finished;
  };
  /**
   * is the viz currenly running
   * @return {boolean} is it running
   */
  self.isRunning = function() {
    return !self.isFinished() && !self.isPaused();
  };
  /**
   * is the viz currenly cancelled
   * @return {boolean} is it running
   */
  self.isCancelled = function() {
    return dash_.internal.cancelled;
  };
  /**
   * get the current progress
   * @return {number} between 0 and 1
   */
  self.getProgress = function() {
    return dash_.internal.progress;
  };
  /**
   * set the progress immediately and stop the viz
   * the completion promise is rejected
   * @param {number} between 0 and 1 to set it to
   * @param {number} [duration=0] how long to take to do it
   * @return {Promise} the master promise
   */
  self.setProgress = function(progress, duration) {
    return work_(0, fixDef_ (duration ,0 ), progress);
  };
  /**
   * reset the paths for the arcs
   */
  function redoPath_() {
    // redo the path
    dInfo_.path = dInfo_.svg.selectAll("path").data(data_);
    // add the new data
    dInfo_.enter = dInfo_.path.enter().append("path")
      .attr("fill", function(d) {
        return d.start.fill
      })
      .attr("d", dInfo_.arc);
    // get rid of any old
    dInfo_.path.exit().remove();
  }
  /**
   * make  a new master promise
   * @return {DashTimer} self
   */
  function resetPromise_() {

    dash_.mp = {};
    dash_.mp.promise = new Promise(function(resolve, reject) {
      dash_.mp.reject = reject;
      dash_.mp.resolve = resolve;
    });
    return self;
    
  }
  /**
   * co-ordinate the work, and manage the completion promises
   * @param {number} start place to start at between 0 and 1
   * @param {number} duration number of seconds to run he transition for
   * @param {number} [finish=1] place to stop at between 0 and 1
   * @return {Promise} a promise that'll be resolved when it times out
   */
  function work_(start, duration, finish) {

    // tidy up from last time
    redoPath_();
    finish = fixDef_ ( finish,1);

    // we'll need this if resuming
    dash_.finishAt = finish;
    dash_.startAt = start;

    // this returns a promise that simply resolves the master promise
    show_(start, duration, finish)
      .then(
        function(expired) {
          self.resolve();
        },
        function(stopped) {
          // nothing to do here - we dont want to resolve or reject the master promise
          // because this was just a pause
        });

    // return the master promise
    return dash_.mp.promise;
  }
 
  /**
   * do the transition
   * @param {number} startAt place to start at between 0 and 1
   * @param {number} duration number of seconds to run he transition for
   * @param {number} finishAt place to stop at between 0 and 1
   * @return {Promise} a promise that'll be resolved when it times out
   */
  function show_(startAt, duration, finishAt) {
    dash_.internal.paused = dash_.internal.finished = dash_.internal.cancelled = false, dash_.internal.progress = 0;
    // this is a promise that will be resolved when the timer runs out
    return new Promise(function(resolve, reject) {

      // interpolation include any startat/finishat generated by a pause
      // this returns a closure with the modified interpolation function
      function rng(a, b) {
        return d3.interpolate(
          d3.interpolate(a, b)(startAt), d3.interpolate(a, b)(1)
        );
      }

      dInfo_.path.transition(dash_.name)
        .ease(dash_.ease)
        .duration(duration)
        .each("end", function(d, i) {
          if (i === data_.length - 1) {
            dash_.internal.finished = true;
            resolve(self)
          }
        })
        .attrTween("d", function(d) {

          // these interpolate closures for each of the transitioing values
          d.interpolate = {
            innerRadius: rng(d.start.innerRadius, d.finish.innerRadius),
            outerRadius: rng(d.start.outerRadius, d.finish.outerRadius),
            endAngle: rng(d.start.angle * TAU, d.finish.angle * TAU),
            value: rng(d.start.value, d.finish.value)
          };

          // returns a closure for each tick
          return function(t) {
            // if a puase has been called in the meantime
            // a transition pause is signalled by rejecting the promise
            if (self.isPaused()) reject(self);

            // statics mean that they dont transition
            Object.keys(d.interpolate).forEach(function(k) {
              if (!d.static[k]) d[k] = d.interpolate[k](t * finishAt);
            });
            dash_.internal.progress = (startAt + (1 - startAt) * t * finishAt);
                      
            // callback if requested
            if(d.callback) d.callback(d , self , t);
            
            // show the interpolated value 
            if (d.values.show) {
              dInfo_.textElements.text(d.values.decorate(d.value));
            }
            return dInfo_.arc(d);
          };
        })
        .styleTween("fill", function(d) {
          return d3.interpolate(
            d3.interpolate(d.start.fill, d.finish.fill)(startAt),
            d3.interpolate(d.start.fill, d.finish.fill)(finishAt));
        });
    });
  };
  /**
   * recursively extend an object with other objects
   * @param {[object]} obs the array of objects to be merged
   * @return {object} the extended object
   */
  function vanMerge_(obs) {
    return (obs || []).reduce(function(p, c) {
      return vanExtend_(p, c);
    }, {});
  }

  function vanExtend_(result, opt) {

    result = result || {};
    return Object.keys(opt).reduce(function(p, c) {
      // if its an object
      if (typeof opt[c] === "object") {
        p[c] = vanExtend_(p[c], opt[c]);
      } else {
        p[c] = opt[c];
      }
      return p;
    }, result);
  }
  
  function fixDef_ (value , defValue) {
    return typeof value === typeof undefined ? defValue : value;
  }
};



