(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports = ['log', '$http', 'TMDB_API', 'EVT', '$cacheFactory', '$q', 'ENDPOINT_URI', function (log, $http, TMDB_API, EVT, $cacheFactory, $q, ENDPOINT_URI) {

	var searchResult = [];
	var prevResultLen = 0;
	var totalPages = -1;
	var currPage = 1;

	var movieIdCache = $cacheFactory('movieIdCache');
	// TMDB_API.url + 'movie/now_playing'

	var DB_ENDPOINT = ENDPOINT_URI + 'movie/';

	function putItemToDB(movieItem) {
		// todo dont put exisiting item in db
		$http.put(DB_ENDPOINT + movieItem.id, movieItem).then(function (res) {
			log.debug('info', 'PUT:', res);
		}, function (err) {
			log.debug('err', 'PUT:', err);
		});
	}

	function searchIdFromDB(id) {
		var promise = $http.get(DB_ENDPOINT + id).then(function (res) {
			log.debug('info', 'searchById => DB:', res.data);
			if (res.data) {
				return res.data;
			} else {
				return null;
			}
		}, function (err) {
			log.debug('err', 'searchById => DB:', err);
		});
		return promise;
	}

	function searchIdFromAPI(id) {
		var promise = $http.get(TMDB_API.url + 'movie/' + id, {
			params: { api_key: TMDB_API.key }
		}).then(function (res) {
			log.debug('info', 'searchById => API:', res.data);
			movieIdCache.put(res.data.id, res.data);
			putItemToDB(res.data);
			return res.data;
		}, function (err) {
			log.debug('err', 'searchById => API:', err);
		});
		return promise;
	}

	function searchById(id) {

		var cachedItem = movieIdCache.get(id);
		if (cachedItem) {
			log.debug('info', 'searchById => cache:', cachedItem);
			return cachedItem;
		}

		var df_DB = $q.defer();
		var df_Res = $q.defer();

		searchIdFromDB(id).then(function (res) {
			if (res) {
				df_DB.resolve(res);
			} else {
				df_DB.reject('not found');
			}
		}, function (err) {
			df_DB.reject(err);
		});

		df_DB.promise.then(function (res_DB) {
			df_Res.resolve(res_DB);
		}, function (err) {
			searchIdFromAPI(id).then(function (res_api) {
				df_Res.resolve(res_api);
			}, function (err_api) {
				df_Res.reject(err_api);
			});
		});

		return df_Res.promise;
	}

	function searchByTitle(searchObj) {

		if (currPage > totalPages && totalPages !== -1) {
			// emit event end of page
			EVT.EOP.emit();
			return;
		}

		$http({
			method: 'GET',
			cache: true,
			url: TMDB_API.url + 'search/movie',
			params: {
				api_key: TMDB_API.key,
				query: searchObj.query,
				page: currPage
			}
		}).then(function (res) {
			// emit event search success
			searchResult = searchResult.concat(removeNoPosterItems(res.data.results));
			totalPages = res.data.total_pages;
			currPage++;
			prevResultLen = searchResult.length;
			log.debug('info', res, res.data);

			// cache
			res.data.results.forEach(function (item) {

				if (!movieIdCache.get(item.id)) {
					movieIdCache.put(item.id, item);
					// putItemToDB( item ); // todo check if already exits in DB
				}
			});
		}, function (err) {
			// emit event search err
			log.debug('err', err);
		});
	}

	function removeNoPosterItems(results) {
		return results.filter(function (item) {
			return !!item.poster_path;
		});
	}

	function getRes() {
		return searchResult;
	}

	function clearSearch() {
		// emit event clearSeach
		searchResult.length = 0;
		prevResultLen = 0;
		totalPages = -1;
		currPage = 1;
	}

	return {
		searchByTitle: searchByTitle,
		searchById: searchById,
		clearSearch: clearSearch,
		getRes: getRes,
		prevResultLen: prevResultLen,
		putItemToDB: putItemToDB
	};
}];

},{}],2:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', 'authToken', function (log, ENDPOINT_URI, $http, $q, authToken) {

	var identity = null;
	var _identityResolved = false;

	function authorize(force) {

		var deferred = $q.defer();

		if (force) identity = null;

		if (identity !== null) {

			deferred.resolve();
		} else {

			$http.get(ENDPOINT_URI + 'auth', { attachJwt: true }).then(function (res) {

				log.debug('info', res, res.data);
				identity = res.data;
				_identityResolved = true;
				deferred.resolve();
			}, function (err) {

				log.debug('warn', err, err.data);
				// todo if jwt expired , deauthorize, remove local storage, redirect
				_identityResolved = true;
				deferred.reject(err);
			});
		}

		return deferred.promise;
	}

	function deauthorize() {
		authToken.removeToken();
		identity = null;
	}

	function isAuthenticated() {
		return identity !== null;
	}

	function identityResolved() {
		return _identityResolved;
	}

	return {

		authorize: authorize,
		deauthorize: deauthorize,
		isAuthenticated: isAuthenticated,
		identityResolved: identityResolved

	};
}];

},{}],3:[function(require,module,exports){
'use strict';

module.exports = ['authToken', function (authToken) {

	function request(config) {

		if (config.attachJwt) {
			var token = authToken.getToken();
			if (token) {
				// http://self-issued.info/docs/draft-ietf-oauth-v2-bearer.html   section 2.1
				// https://developers.google.com/gmail/markup/actions/verifying-bearer-tokens
				// http://www.w3.org/Protocols/rfc2616/rfc2616-sec4.html section 4.2 header field name case insensitive
				config.headers.Authorization = 'Bearer ' + token;
			}
		}

		return config;
	}

	function response(res) {
		return res;
	}

	return {

		request: request,
		response: response

	};
}];

},{}],4:[function(require,module,exports){
'use strict';

module.exports = ['log', '$window', function (log, $window) {

	var storage = $window.localStorage;
	var cachedToken = null;

	function setToken(token) {
		cachedToken = token;
		storage.setItem('jwt', token);
	}

	function getToken() {
		if (!cachedToken) {
			cachedToken = storage.getItem('jwt');
		}
		return cachedToken;
	}

	function removeToken() {
		cachedToken = null;
		storage.removeItem('jwt');
		log.debug('info', 'token removed');
	}

	function hasToken() {
		return !!getToken();
	}

	return {

		setToken: setToken,
		getToken: getToken,
		removeToken: removeToken,
		hasToken: hasToken

	};
}];

},{}],5:[function(require,module,exports){
'use strict';

module.exports = ['$scope', 'auth', function ($scope, auth) {}];

},{}],6:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function () {

		if (vm.user.email === '' || vm.user.password === '') {
			log.debug('warn', 'email & password required.');
			return;
		}

		$http.post(ENDPOINT_URI + 'signin', vm.user).then(function (res) {
			log.debug('info', res, res.data);
			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err, status) {
			log.debug('warn', err);
		});
	};
}];

},{}],7:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'auth', function ($state, auth) {

	auth.deauthorize();
	$state.go('signin');
}];

},{}],8:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {};

	vm.signup = function () {

		if (vm.user.email === undefined || vm.user.password === undefined) {
			log.debug('warn', 'email & password required.');
			return;
		}

		log.debug('warn', 'signing up...');
		$http.post(ENDPOINT_URI + 'signup', vm.user).then(function (res) {

			log.debug('info', 'Registered.');
			log.debug('info', res);

			authToken.setToken(res.data.token);
			$state.go('private');
		}, function (err) {

			log.debug('warn', err);
			vm.form.$submitted = false;
		});
	};
}];

},{}],9:[function(require,module,exports){
'use strict';

module.exports = [function () {

	var debugEnabled = false;
	var debugNamespaces = [];

	this.enableDebug = function () {
		debugEnabled = true;
	};

	this.enableDebugNamespace = function () {
		for (var i = 0; i < arguments.length; i++) {
			debugNamespaces.push(arguments[i]);
		}
	};

	this.$get = function () {

		function debug() {
			if (!debugEnabled) return;
			var debugName = arguments[0];
			var slicedArgs = Array.prototype.slice.call(arguments, 1);
			if (debugName === 'err') {
				console.error.apply(console, slicedArgs);
			} else if (debugName === 'info') {
				console.info.apply(console, slicedArgs);
			} else if (debugName === 'warn') {
				console.warn.apply(console, slicedArgs);
			} else if (debugNamespaces.indexOf(debugName) !== -1) {
				console.log.apply(console, slicedArgs);
			}
		}

		return {
			debug: debug
		};
	};
}];

},{}],10:[function(require,module,exports){
'use strict';

module.exports = ['$rootScope', function ($rootScope) {

	var EVT = {

		EOP: {
			listen: function listen(cb) {
				$rootScope.$on('EOP', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('EOP');
			}
		}

	};

	return EVT;
}];

},{}],11:[function(require,module,exports){
'use strict';

module.exports = ['$window', 'ENGINE', 'util', function ($window, ENGINE, util) {

	function ctrl($scope, $element) {

		ENGINE.attachRenderer($element);
		$($window).on('resize', util.debounce(ENGINE.onWindowResize, 100));
		$element.on('wheel', function (evt) {
			ENGINE.$$.wheel_dy = -Math.sign(evt.originalEvent.deltaY);
		});

		ENGINE.start();
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div id="canvas-container"></div>'
	};
}];

},{}],12:[function(require,module,exports){
'use strict';

module.exports = ['$window', function ($window) {

	var $$ = {
		canvas: null,
		stats: new Stats(),
		scene: new THREE.Scene(),
		width: $window.innerWidth,
		height: $window.innerHeight,
		camera: new THREE.PerspectiveCamera(70, this.width / this.height, 10, 100000),
		renderer: new THREE.CSS3DRenderer(),
		screen_ratio: this.width / this.height,
		pixel_ratio: $window.devicePixelRatio || 1,
		mouse_x: this.width * 0.5,
		mouse_y: this.height * 0.5,
		wheel_dy: 0
	};

	$$.renderer.setSize($$.width, $$.height);

	function attachRenderer(canvas) {
		$$.canvas = canvas;
		canvas.append($$.renderer.domElement);
		canvas.append($$.stats.domElement);
	}

	function onWindowResize() {
		$$.width = $window.innerWidth;
		$$.height = $window.innerHeight;
		$$.pixel_ratio = $window.devicePixelRatio || 1;
		$$.screen_ratio = $$.width / $$.height;
		$$.camera.aspect = $$.screen_ratio;
		$$.camera.updateProjectionMatrix();
		$$.renderer.setSize($$.width, $$.height);
	}

	function setup() {}

	function update() {

		if (Math.abs($$.wheel_dy) > 0.001) {
			$$.camera.position.y += $$.wheel_dy * 1.0;
			$$.camera.rotateY($$.wheel_dy * 0.025);
			$$.wheel_dy *= 0.95;
		}
	}

	// ----  draw loop
	function run() {

		requestAnimationFrame(run);
		update();
		$$.renderer.render($$.scene, $$.camera);
		$$.stats.update();
	}

	function start() {
		setup();
		run();
	}

	function resetCamera() {
		$$.camera.position.set(0, 0, 0);
		$$.camera.rotation.set(0, 0, 0);
	}

	return {
		$$: $$,
		attachRenderer: attachRenderer,
		onWindowResize: onWindowResize,
		start: start,
		resetCamera: resetCamera
	};
}];

},{}],13:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENGINE', '$compile', '$rootScope', function (log, ENGINE, $compile, $rootScope) {

	var allPosters = new THREE.Object3D();
	ENGINE.$$.scene.add(allPosters);

	function makeHelixPosters(posterObjectMulti, offsetStartIdx) {

		var vector = new THREE.Vector3();
		var radius = 900;
		for (var i = 0; i < posterObjectMulti.length; i++) {

			var $isolatedScope = $rootScope.$new(true);
			$isolatedScope.movieItem = posterObjectMulti[i];

			var posterDirectiveElem = $compile('<poster></poster>')($isolatedScope)[0];
			var css3dObj = new THREE.CSS3DObject(posterDirectiveElem);

			// tag alog an isolatedScope to be destroy when dispose an element
			css3dObj.scope = $isolatedScope;

			var hidx = i + offsetStartIdx;
			var phi = hidx * 0.175 + Math.PI;
			css3dObj.position.x = -radius * Math.sin(phi);
			css3dObj.position.y = -(hidx * 8) + 200;
			css3dObj.position.z = radius * Math.cos(phi);

			vector.set(-css3dObj.position.x * 2, css3dObj.position.y, -css3dObj.position.z * 2);

			css3dObj.lookAt(vector);
			allPosters.add(css3dObj);
		}

		log.debug('info', 'curr posters:', allPosters.children.length);
	}

	function clearAll() {
		allPosters.children.forEach(function (poster) {
			poster.disposeElement();
			poster.scope.$destroy();
		});
		allPosters.children.length = 0; // clear items
	}

	return {
		makeHelixPosters: makeHelixPosters,
		clearAll: clearAll
	};
}];

},{}],14:[function(require,module,exports){
'use strict';

module.exports = ['$state', function ($state) {

	function ctrl($scope, $element) {

		// $scope.movieItem obj is passed thru isolatedScope via compiled directive in helix.fac.js

		var img = new Image();
		var imgUrl = 'http://image.tmdb.org/t/p/w154/' + $scope.movieItem.poster_path;
		img.onload = function () {

			// todo move css into sass, use class instead
			$element.css({
				'width': '150px',
				'height': '230px',
				'background-repeat': 'no-repeat',
				'background-size': '150px 230px',
				'background-image': 'url(' + imgUrl + ')',
				'display': 'none' // required for fadeIn animation
			});
			$element.fadeIn(1500);
		};
		img.src = imgUrl;

		$element.on('click', function (evt) {
			$state.go('movieDetail', { movieId: $scope.movieItem.id });
		});
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};
}];

},{}],15:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./debug/log.pv.js')).factory('util', require('./util.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('TMDb', require('./TMDb.fac.js')).factory('EVT', require('./events.fac.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).directive('display', require('./helix/display.dir.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('poster', require('./helix/poster.dir.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).controller('collectionCtrl', require('./auth/collection.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).config(['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

	$urlRouterProvider.otherwise('/');

	$stateProvider.state('home', {
		url: '/',
		templateUrl: './template/home.html'
	}).state('movieDetail', {
		url: '/movie/:movieId',
		templateUrl: './template/movie.html',
		controller: 'movieDetailCtrl',
		controllerAs: 'md',
		resolve: {
			movieItem: ['$stateParams', 'TMDb', function ($stateParams, TMDb) {
				return TMDb.searchById($stateParams.movieId);
			}]
		}
	}).state('signup', {
		url: '/signup',
		templateUrl: './template/signup.html',
		controller: 'signupCtrl',
		controllerAs: 'signup'
	}).state('signin', {
		url: '/signin',
		templateUrl: './template/signin.html',
		controller: 'signinCtrl',
		controllerAs: 'signin'
	}).state('signout', {
		url: '/signout',
		controller: 'signoutCtrl'
	}).state('collection', {
		url: '/collection',
		templateUrl: './template/collection.html',
		controller: 'collectionCtrl',
		controllerAs: 'coll',
		resolve: {
			authorize: ['auth', function (auth) {
				return auth.authorize();
			}]
		}
	});

	$httpProvider.interceptors.push('authInterceptor');
}]).run(['log', '$rootScope', '$state', 'auth', function (log, $rootScope, $state, auth) {

	// todo authorize user every beginning of session
	auth.authorize(true);

	$rootScope.$on('$stateChangeError', function (event, toState, toParams, fromState, fromParams, error) {

		event.preventDefault(); // prevent transition
		log.debug('warn', error);
		if (error) {
			$state.go('signin');
		}
	});
}]).config(['logProvider', '$httpProvider', function (logProvider, $httpProvider) {

	logProvider.enableDebug();
	logProvider.enableDebugNamespace('info', 'err', 'auth'); // ctrl

	$httpProvider.useLegacyPromiseExtensions(false);
}]);

},{"./TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/collection.ctrl.js":5,"./auth/signin.ctrl.js":6,"./auth/signout.ctrl.js":7,"./auth/signup.ctrl.js":8,"./debug/log.pv.js":9,"./events.fac.js":10,"./helix/display.dir.js":11,"./helix/engine.fac.js":12,"./helix/helix.fac.js":13,"./helix/poster.dir.js":14,"./main.ctrl.js":16,"./movieDetail.ctrl.js":17,"./util.js":18}],16:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', function (log, $scope, TMDb, EVT, helix, ENGINE) {

	var vm = this;
	vm.search = {
		query: ''
	};
	vm.movieItems = null;

	$scope.$watch(TMDb.getRes, function (movItems) {

		vm.movieItems = movItems;
		helix.makeHelixPosters(movItems.slice(TMDb.prevResultLen), TMDb.prevResultLen);
	}, true);

	var prevQuery = '';
	vm.search = function () {
		if (vm.search.query === '') return;
		if (prevQuery !== vm.search.query) {
			prevQuery = vm.search.query;
			TMDb.clearSearch();
			helix.clearAll();
			ENGINE.resetCamera();
		}
		TMDb.searchByTitle(vm.search);
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;

	EVT.EOP.listen(function () {
		log.debug('info', 'recieved EOP event!');
	});
}];

},{}],17:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', function (log, $scope, TMDb, $cacheFactory, movieItem) {

	var vm = this;
	vm.movieItem = movieItem; // movieItem injected via state resolve
	log.debug('ctrl', 'movieDetail ctrl resolved:', vm.movieItem);

	movieItem.fullTitle = movieItem.title;
	if (movieItem.title !== movieItem.original_title) {
		movieItem.fullTitle = movieItem.title + ' (' + movieItem.original_title + ')';
	}

	if (movieItem.backdrop_path) {
		var imgUrl = 'http://image.tmdb.org/t/p/original' + movieItem.backdrop_path;
		$('.backdrop').css({
			'background-image': 'url(' + imgUrl + ')'
		});
	}
}];

},{}],18:[function(require,module,exports){
"use strict";

module.exports = [function () {

	function debounce(func, wait, immediate) {
		var _this = this,
		    _arguments = arguments;

		var timeout;
		return function () {

			var context = _this,
			    args = _arguments;
			var later = function later() {

				timeout = null;
				if (!immediate) func.apply(context, args);
			};
			var callNow = immediate && !timeout;
			clearTimeout(timeout);
			timeout = setTimeout(later, wait);
			if (callNow) func.apply(context, args);
		};
	}

	return {
		debounce: debounce
	};
}];

},{}]},{},[15])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9UTURiLmZhYy5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvYXV0aC5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhJbnRlcmNlcHRvci5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2F1dGhUb2tlbi5mYWMuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL2NvbGxlY3Rpb24uY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbmluLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9hdXRoL3NpZ25vdXQuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2F1dGgvc2lnbnVwLmN0cmwuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9kZWJ1Zy9sb2cucHYuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9ldmVudHMuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCJFOi94YW1wcC9odGRvY3MvYXVjcy13ZWJkZXYtdGVybS1wcm9qZWN0L3NyYy9oZWxpeC9lbmdpbmUuZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvaGVsaXguZmFjLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL2luZGV4LmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbWFpbi5jdHJsLmpzIiwiRToveGFtcHAvaHRkb2NzL2F1Y3Mtd2ViZGV2LXRlcm0tcHJvamVjdC9zcmMvbW92aWVEZXRhaWwuY3RybC5qcyIsIkU6L3hhbXBwL2h0ZG9jcy9hdWNzLXdlYmRldi10ZXJtLXByb2plY3Qvc3JjL3V0aWwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQzNGLFVBQVcsR0FBRyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFHOztBQUV2RSxLQUFJLFlBQVksR0FBRyxFQUFFLENBQUM7QUFDdEIsS0FBSSxhQUFhLEdBQUcsQ0FBQyxDQUFDO0FBQ3RCLEtBQUksVUFBVSxHQUFHLENBQUMsQ0FBQyxDQUFDO0FBQ3BCLEtBQUksUUFBUSxHQUFHLENBQUMsQ0FBQzs7QUFFakIsS0FBSSxZQUFZLEdBQUcsYUFBYSxDQUFFLGNBQWMsQ0FBRSxDQUFDOzs7QUFHbkQsS0FBSSxXQUFXLEdBQUcsWUFBWSxHQUFHLFFBQVEsQ0FBQzs7QUFFMUMsVUFBUyxXQUFXLENBQUUsU0FBUyxFQUFHOztBQUVqQyxPQUFLLENBQUMsR0FBRyxDQUFFLFdBQVcsR0FBRyxTQUFTLENBQUMsRUFBRSxFQUFFLFNBQVMsQ0FBRSxDQUNqRCxJQUFJLENBQUUs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QUFDeEIsVUFBTyxHQUFHLFVBQVUsQ0FBRSxLQUFLLEVBQUUsSUFBSSxDQUFFLENBQUM7QUFDcEMsT0FBSyxPQUFPLEVBQUcsSUFBSSxDQUFDLEtBQUssQ0FBRSxPQUFPLEVBQUUsSUFBSSxDQUFFLENBQUM7R0FDM0MsQ0FBQztFQUNGOztBQUVELFFBQU87QUFDTixVQUFRLEVBQVIsUUFBUTtFQUNSLENBQUM7Q0FFRixDQUFFLENBQUMiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJGh0dHAnLCAnVE1EQl9BUEknLCAnRVZUJywgJyRjYWNoZUZhY3RvcnknLCAnJHEnLCAnRU5EUE9JTlRfVVJJJyxcclxuZnVuY3Rpb24gKCBsb2csICRodHRwLCBUTURCX0FQSSwgRVZULCAkY2FjaGVGYWN0b3J5LCAkcSwgRU5EUE9JTlRfVVJJICkge1xyXG5cclxuXHR2YXIgc2VhcmNoUmVzdWx0ID0gW107XHJcblx0dmFyIHByZXZSZXN1bHRMZW4gPSAwO1xyXG5cdHZhciB0b3RhbFBhZ2VzID0gLTE7XHJcblx0dmFyIGN1cnJQYWdlID0gMTtcclxuXHJcblx0dmFyIG1vdmllSWRDYWNoZSA9ICRjYWNoZUZhY3RvcnkoICdtb3ZpZUlkQ2FjaGUnICk7XHJcblx0Ly8gVE1EQl9BUEkudXJsICsgJ21vdmllL25vd19wbGF5aW5nJ1xyXG5cclxuXHR2YXIgREJfRU5EUE9JTlQgPSBFTkRQT0lOVF9VUkkgKyAnbW92aWUvJztcclxuXHJcblx0ZnVuY3Rpb24gcHV0SXRlbVRvREIoIG1vdmllSXRlbSApIHtcclxuXHRcdC8vIHRvZG8gZG9udCBwdXQgZXhpc2l0aW5nIGl0ZW0gaW4gZGJcclxuXHRcdCRodHRwLnB1dCggREJfRU5EUE9JTlQgKyBtb3ZpZUl0ZW0uaWQsIG1vdmllSXRlbSApXHJcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnUFVUOicsIHJlcyApO1xyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdQVVQ6JywgZXJyICk7XHJcblx0XHR9ICk7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tREIoIGlkICkge1xyXG5cdFx0dmFyIHByb21pc2UgPSAkaHR0cC5nZXQoIERCX0VORFBPSU5UICsgaWQgKVxyXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3NlYXJjaEJ5SWQgPT4gREI6JywgcmVzLmRhdGEgKTtcclxuXHRcdFx0aWYgKCByZXMuZGF0YSApIHtcclxuXHRcdFx0XHRyZXR1cm4gcmVzLmRhdGE7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0cmV0dXJuIG51bGw7XHJcblx0XHRcdH1cclxuXHRcdH0sIGZ1bmN0aW9uKCBlcnIgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeUlkID0+IERCOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdFx0cmV0dXJuIHByb21pc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21BUEkoIGlkICkge1xyXG5cdFx0dmFyIHByb21pc2UgPSAkaHR0cC5nZXQoIFRNREJfQVBJLnVybCArICdtb3ZpZS8nICsgaWQsIHtcclxuXHRcdFx0cGFyYW1zOiB7IGFwaV9rZXk6IFRNREJfQVBJLmtleSB9XHJcblx0XHR9ICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgcmVzLmRhdGEgKTtcclxuXHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XHJcblx0XHRcdHB1dEl0ZW1Ub0RCKCByZXMuZGF0YSApO1xyXG5cdFx0XHRyZXR1cm4gcmVzLmRhdGE7XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5SWQgPT4gQVBJOicsIGVyciApO1xyXG5cdFx0fSApO1xyXG5cdFx0cmV0dXJuIHByb21pc2U7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBzZWFyY2hCeUlkKCBpZCApIHtcclxuXHJcblx0XHR2YXIgY2FjaGVkSXRlbSA9IG1vdmllSWRDYWNoZS5nZXQoIGlkICk7XHJcblx0XHRpZiAoIGNhY2hlZEl0ZW0gKSB7XHJcblx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnc2VhcmNoQnlJZCA9PiBjYWNoZTonLCBjYWNoZWRJdGVtICk7XHJcblx0XHRcdHJldHVybiBjYWNoZWRJdGVtO1xyXG5cdFx0fVxyXG5cclxuXHRcdHZhciBkZl9EQiA9ICRxLmRlZmVyKCk7XHJcblx0XHR2YXIgZGZfUmVzID0gJHEuZGVmZXIoKTtcclxuXHJcblx0XHRzZWFyY2hJZEZyb21EQiggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcclxuXHRcdFx0aWYgKCByZXMgKSB7XHJcblx0XHRcdFx0ZGZfREIucmVzb2x2ZSggcmVzICk7XHJcblx0XHRcdH0gZWxzZSB7XHJcblx0XHRcdFx0ZGZfREIucmVqZWN0KCAnbm90IGZvdW5kJyApO1xyXG5cdFx0XHR9XHJcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcclxuXHRcdFx0XHRkZl9EQi5yZWplY3QoIGVyciApO1xyXG5cdFx0fSApO1xyXG5cclxuXHRcdGRmX0RCLnByb21pc2UudGhlbiggZnVuY3Rpb24gKCByZXNfREIgKSB7XHJcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfREIgKTtcclxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cdFx0XHRzZWFyY2hJZEZyb21BUEkoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXNfYXBpICkge1xyXG5cdFx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfYXBpICk7XHJcblx0XHRcdH0sIGZ1bmN0aW9uICggZXJyX2FwaSApIHtcclxuXHRcdFx0XHRkZl9SZXMucmVqZWN0KCBlcnJfYXBpICk7XHJcblx0XHRcdH0gKTtcclxuXHRcdH0gKTtcclxuXHJcblx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XHJcblxyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gc2VhcmNoQnlUaXRsZSggc2VhcmNoT2JqICkge1xyXG5cclxuXHRcdGlmICggY3VyclBhZ2UgPiB0b3RhbFBhZ2VzICYmIHRvdGFsUGFnZXMgIT09IC0xICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IGVuZCBvZiBwYWdlXHJcblx0XHRcdEVWVC5FT1AuZW1pdCgpO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblxyXG5cdFx0JGh0dHAoIHtcclxuXHRcdFx0bWV0aG9kOiAnR0VUJyxcclxuXHRcdFx0Y2FjaGU6IHRydWUsXHJcblx0XHRcdHVybDogVE1EQl9BUEkudXJsICsgJ3NlYXJjaC9tb3ZpZScsXHJcblx0XHRcdHBhcmFtczp7XHJcblx0XHRcdFx0YXBpX2tleTogVE1EQl9BUEkua2V5LFxyXG5cdFx0XHRcdHF1ZXJ5OiBzZWFyY2hPYmoucXVlcnksXHJcblx0XHRcdFx0cGFnZTogY3VyclBhZ2VcclxuXHRcdFx0fVxyXG5cdFx0fSApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xyXG5cdFx0XHQvLyBlbWl0IGV2ZW50IHNlYXJjaCBzdWNjZXNzXHJcblx0XHRcdHNlYXJjaFJlc3VsdCA9IHNlYXJjaFJlc3VsdC5jb25jYXQoIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlcy5kYXRhLnJlc3VsdHMgKSApO1xyXG5cdFx0XHR0b3RhbFBhZ2VzID0gcmVzLmRhdGEudG90YWxfcGFnZXM7XHJcblx0XHRcdGN1cnJQYWdlICsrO1xyXG5cdFx0XHRwcmV2UmVzdWx0TGVuID0gc2VhcmNoUmVzdWx0Lmxlbmd0aDtcclxuXHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsIHJlcywgcmVzLmRhdGEgKTtcclxuXHJcblx0XHRcdC8vIGNhY2hlXHJcblx0XHRcdHJlcy5kYXRhLnJlc3VsdHMuZm9yRWFjaCggZnVuY3Rpb24gKCBpdGVtICkge1xyXG5cclxuXHRcdFx0XHRpZiAoICFtb3ZpZUlkQ2FjaGUuZ2V0KCBpdGVtLmlkICkgKSB7XHJcblx0XHRcdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCBpdGVtLmlkLCBpdGVtICk7XHJcblx0XHRcdFx0XHQvLyBwdXRJdGVtVG9EQiggaXRlbSApOyAvLyB0b2RvIGNoZWNrIGlmIGFscmVhZHkgZXhpdHMgaW4gREJcclxuXHRcdFx0XHR9XHJcblxyXG5cdFx0XHR9ICk7XHJcblxyXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XHJcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIGVyclxyXG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCBlcnIgKTtcclxuXHRcdH0gKTtcclxuXHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiByZW1vdmVOb1Bvc3Rlckl0ZW1zKCByZXN1bHRzICkge1xyXG5cdFx0cmV0dXJuIHJlc3VsdHMuZmlsdGVyKCBmdW5jdGlvbiAoIGl0ZW0gKSB7XHJcblx0XHRcdHJldHVybiAhIWl0ZW0ucG9zdGVyX3BhdGg7XHJcblx0XHR9ICk7XHJcblx0fVxyXG5cclxuXHRmdW5jdGlvbiBnZXRSZXMoKSB7XHJcblx0XHRyZXR1cm4gc2VhcmNoUmVzdWx0O1xyXG5cdH1cclxuXHJcblx0ZnVuY3Rpb24gY2xlYXJTZWFyY2goKSB7XHJcblx0XHQvLyBlbWl0IGV2ZW50IGNsZWFyU2VhY2hcclxuXHRcdHNlYXJjaFJlc3VsdC5sZW5ndGggPSAwO1xyXG5cdFx0cHJldlJlc3VsdExlbiA9IDA7XHJcblx0XHR0b3RhbFBhZ2VzID0gLTE7XHJcblx0XHRjdXJyUGFnZSA9IDE7XHJcblx0fVxyXG5cclxuXHRyZXR1cm4ge1xyXG5cdFx0c2VhcmNoQnlUaXRsZSxcclxuXHRcdHNlYXJjaEJ5SWQsXHJcblx0XHRjbGVhclNlYXJjaCxcclxuXHRcdGdldFJlcyxcclxuXHRcdHByZXZSZXN1bHRMZW4sXHJcblx0XHRwdXRJdGVtVG9EQlxyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VORFBPSU5UX1VSSScsICckaHR0cCcsICckcScsICdhdXRoVG9rZW4nLFxuZnVuY3Rpb24gKCBsb2csIEVORFBPSU5UX1VSSSwgJGh0dHAsICRxLCBhdXRoVG9rZW4gKSB7XG5cblx0XHR2YXIgaWRlbnRpdHkgPSBudWxsO1xuXHRcdHZhciBfaWRlbnRpdHlSZXNvbHZlZCA9IGZhbHNlO1xuXG5cdFx0ZnVuY3Rpb24gYXV0aG9yaXplKCBmb3JjZSApIHtcblxuXHRcdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcblxuXHRcdFx0aWYgKCBmb3JjZSApIGlkZW50aXR5ID0gbnVsbDtcblxuXHRcdFx0aWYgKCBpZGVudGl0eSAhPT0gbnVsbCApIHtcblxuXHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCk7XG5cblx0XHRcdH0gZWxzZSB7XG5cblx0XHRcdFx0JGh0dHAuZ2V0KCBFTkRQT0lOVF9VUkkgKyAnYXV0aCcsIHsgYXR0YWNoSnd0OiB0cnVlIH0gKVxuXHRcdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnaW5mbycsIHJlcywgcmVzLmRhdGEgKTtcblx0XHRcdFx0XHRcdGlkZW50aXR5ID0gcmVzLmRhdGE7XG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCk7XG5cblx0XHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsIGVyciwgZXJyLmRhdGEgKTtcblx0XHRcdFx0XHRcdC8vIHRvZG8gaWYgand0IGV4cGlyZWQgLCBkZWF1dGhvcml6ZSwgcmVtb3ZlIGxvY2FsIHN0b3JhZ2UsIHJlZGlyZWN0XG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZWplY3QoIGVyciApO1xuXG5cdFx0XHRcdFx0fSApO1xuXG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xuXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gZGVhdXRob3JpemUoKSB7XG5cdFx0XHRhdXRoVG9rZW4ucmVtb3ZlVG9rZW4oKTtcblx0XHRcdGlkZW50aXR5ID0gbnVsbDtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBpc0F1dGhlbnRpY2F0ZWQoKSB7XG5cdFx0XHRyZXR1cm4gaWRlbnRpdHkgIT09IG51bGw7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gaWRlbnRpdHlSZXNvbHZlZCgpIHtcblx0XHRcdHJldHVybiBfaWRlbnRpdHlSZXNvbHZlZDtcblx0XHR9XG5cblx0XHRyZXR1cm4ge1xuXG5cdFx0XHRhdXRob3JpemUsXG5cdFx0XHRkZWF1dGhvcml6ZSxcblx0XHRcdGlzQXV0aGVudGljYXRlZCxcblx0XHRcdGlkZW50aXR5UmVzb2x2ZWRcblxuXHRcdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnYXV0aFRva2VuJywgZnVuY3Rpb24gKCBhdXRoVG9rZW4gKSB7XG5cblx0ZnVuY3Rpb24gcmVxdWVzdCggY29uZmlnICkge1xuXG5cdFx0aWYgKCBjb25maWcuYXR0YWNoSnd0ICkge1xuXHRcdFx0dmFyIHRva2VuID0gYXV0aFRva2VuLmdldFRva2VuKCk7XG5cdFx0XHRpZiAoIHRva2VuICkge1xuXHRcdFx0XHQvLyBodHRwOi8vc2VsZi1pc3N1ZWQuaW5mby9kb2NzL2RyYWZ0LWlldGYtb2F1dGgtdjItYmVhcmVyLmh0bWwgICBzZWN0aW9uIDIuMVxuXHRcdFx0XHQvLyBodHRwczovL2RldmVsb3BlcnMuZ29vZ2xlLmNvbS9nbWFpbC9tYXJrdXAvYWN0aW9ucy92ZXJpZnlpbmctYmVhcmVyLXRva2Vuc1xuXHRcdFx0XHQvLyBodHRwOi8vd3d3LnczLm9yZy9Qcm90b2NvbHMvcmZjMjYxNi9yZmMyNjE2LXNlYzQuaHRtbCBzZWN0aW9uIDQuMiBoZWFkZXIgZmllbGQgbmFtZSBjYXNlIGluc2Vuc2l0aXZlXG5cdFx0XHRcdGNvbmZpZy5oZWFkZXJzLkF1dGhvcml6YXRpb24gPSAnQmVhcmVyICcgKyB0b2tlbjtcblx0XHRcdH1cblx0XHR9XG5cblx0XHRyZXR1cm4gY29uZmlnO1xuXG5cdH1cblxuXHRmdW5jdGlvbiByZXNwb25zZSggcmVzICkge1xuXHRcdHJldHVybiByZXM7XG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0cmVxdWVzdCxcblx0XHRyZXNwb25zZVxuXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHdpbmRvdycsIGZ1bmN0aW9uICggbG9nLCAkd2luZG93ICkge1xuXG5cdHZhciBzdG9yYWdlID0gJHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG5cdHZhciBjYWNoZWRUb2tlbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gc2V0VG9rZW4oIHRva2VuICkge1xuXHRcdGNhY2hlZFRva2VuID0gdG9rZW47XG5cdFx0c3RvcmFnZS5zZXRJdGVtKCAnand0JywgdG9rZW4gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdldFRva2VuKCkge1xuXHRcdGlmICggIWNhY2hlZFRva2VuICkge1xuXHRcdFx0Y2FjaGVkVG9rZW4gPSBzdG9yYWdlLmdldEl0ZW0oICdqd3QnICk7XG5cdFx0fVxuXHRcdHJldHVybiBjYWNoZWRUb2tlbjtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZVRva2VuKCkge1xuXHRcdGNhY2hlZFRva2VuID0gbnVsbDtcblx0XHRzdG9yYWdlLnJlbW92ZUl0ZW0oICdqd3QnICk7XG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICd0b2tlbiByZW1vdmVkJyApO1xuXHR9XG5cblx0ZnVuY3Rpb24gaGFzVG9rZW4oKSB7XG5cdFx0cmV0dXJuICEhZ2V0VG9rZW4oKTtcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRzZXRUb2tlbixcblx0XHRnZXRUb2tlbixcblx0XHRyZW1vdmVUb2tlbixcblx0XHRoYXNUb2tlblxuXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc2NvcGUnLCAnYXV0aCcsIGZ1bmN0aW9uICggJHNjb3BlLCBhdXRoICkgIHtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcclxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgJGh0dHAsIEVORFBPSU5UX1VSSSwgYXV0aFRva2VuLCAkc3RhdGUgKSAge1xyXG5cclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLnVzZXIgPSB7XHJcblx0XHRlbWFpbDogJycsXHJcblx0XHRwYXNzd29yZDogJydcclxuXHR9O1xyXG5cclxuXHR2bS5zaWduaW4gPSBmdW5jdGlvbigpIHtcclxuXHJcblx0XHRpZiAoIHZtLnVzZXIuZW1haWwgPT09ICcnIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09ICcnICkge1xyXG5cdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xyXG5cdFx0XHRyZXR1cm47XHJcblx0XHR9XHJcblxyXG5cdFx0JGh0dHAucG9zdCggRU5EUE9JTlRfVVJJICsgJ3NpZ25pbicsIHZtLnVzZXIgKVxyXG5cdFx0XHQudGhlbiggZnVuY3Rpb24oIHJlcyApIHtcclxuXHRcdFx0XHRsb2cuZGVidWcoICdpbmZvJywgcmVzLCByZXMuZGF0YSApO1xyXG5cdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcclxuXHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xyXG5cdFx0XHR9LCBmdW5jdGlvbiggZXJyLCBzdGF0dXMgKSB7XHJcblx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsIGVyciApO1xyXG5cdFx0XHR9ICk7XHJcblxyXG5cdH07XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlJywgJ2F1dGgnLCBmdW5jdGlvbiAoICRzdGF0ZSwgYXV0aCApICB7XHJcblxyXG5cdGF1dGguZGVhdXRob3JpemUoKTtcclxuXHQkc3RhdGUuZ28oICdzaWduaW4nICk7XHJcblxyXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICckaHR0cCcsICdFTkRQT0lOVF9VUkknLCAnYXV0aFRva2VuJywgJyRzdGF0ZScsXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApIHtcblxuXHRcdHZhciB2bSA9IHRoaXM7XG5cdFx0dm0udXNlciA9IHt9O1xuXG5cdFx0dm0uc2lnbnVwID0gZnVuY3Rpb24gKCkge1xyXG5cblx0XHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gdW5kZWZpbmVkIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09IHVuZGVmaW5lZCApIHtcblx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsICdlbWFpbCAmIHBhc3N3b3JkIHJlcXVpcmVkLicgKTtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ3NpZ25pbmcgdXAuLi4nICk7XHJcblx0XHRcdCRodHRwLnBvc3QoIEVORFBPSU5UX1VSSSArICdzaWdudXAnLCB2bS51c2VyIClcclxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XHJcblxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnUmVnaXN0ZXJlZC4nICk7XHJcblx0XHRcdFx0XHRsb2cuZGVidWcoICdpbmZvJywgcmVzICk7XHJcblxyXG5cdFx0XHRcdFx0YXV0aFRva2VuLnNldFRva2VuKCByZXMuZGF0YS50b2tlbiApO1xyXG5cdFx0XHRcdFx0JHN0YXRlLmdvKCAncHJpdmF0ZScgKTtcclxuXG5cdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xyXG5cblx0XHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgZXJyICk7XG5cdFx0XHRcdFx0dm0uZm9ybS4kc3VibWl0dGVkID0gZmFsc2U7XHJcblxuXHRcdFx0XHR9ICk7XHJcblxuXHRcdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcblxuXHR2YXIgZGVidWdFbmFibGVkID0gZmFsc2U7XG5cdHZhciBkZWJ1Z05hbWVzcGFjZXMgPSBbXTtcblxuXHR0aGlzLmVuYWJsZURlYnVnID0gZnVuY3Rpb24gKCkge1xuXHRcdGRlYnVnRW5hYmxlZCA9IHRydWU7XG5cdH07XG5cblx0dGhpcy5lbmFibGVEZWJ1Z05hbWVzcGFjZSA9IGZ1bmN0aW9uICgpIHtcblx0XHRmb3IgKCBsZXQgaSA9IDA7IGkgPCBhcmd1bWVudHMubGVuZ3RoOyBpKysgKSB7XG5cdFx0XHRkZWJ1Z05hbWVzcGFjZXMucHVzaCggYXJndW1lbnRzWyBpIF0gKTtcblx0XHR9XG5cdH07XG5cblx0dGhpcy4kZ2V0ID0gKCkgPT4ge1xuXG5cdFx0ZnVuY3Rpb24gZGVidWcoKSB7XG5cdFx0XHRpZiAoICFkZWJ1Z0VuYWJsZWQgKSByZXR1cm47XHJcblx0XHRcdHZhciBkZWJ1Z05hbWUgPSBhcmd1bWVudHNbIDAgXTtcclxuXHRcdFx0dmFyIHNsaWNlZEFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCggYXJndW1lbnRzLCAxICk7XHJcblx0XHRcdGlmICggZGVidWdOYW1lID09PSAnZXJyJyApIHtcclxuXHRcdFx0XHRjb25zb2xlLmVycm9yLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XHJcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ2luZm8nICkge1xyXG5cdFx0XHRcdGNvbnNvbGUuaW5mby5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xyXG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWUgPT09ICd3YXJuJyApIHtcclxuXHRcdFx0XHRjb25zb2xlLndhcm4uYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcclxuXHRcdFx0fSBlbHNlIGlmICggZGVidWdOYW1lc3BhY2VzLmluZGV4T2YoIGRlYnVnTmFtZSApICE9PSAtMSApIHtcclxuXHRcdFx0XHRjb25zb2xlLmxvZy5hcHBseSggY29uc29sZSwgc2xpY2VkQXJncyApO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiB7XG5cdFx0XHRkZWJ1Z1xuXHRcdH07XG5cblx0fTtcblxufSBdO1xyXG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRyb290U2NvcGUnLCBmdW5jdGlvbiAoICRyb290U2NvcGUgKSB7XHJcblxyXG5cdHZhciBFVlQgPSB7XHJcblxyXG5cdFx0RU9QOiB7XHJcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdFT1AnLCBjYiApOyB9LFxyXG5cdFx0XHRlbWl0OiBmdW5jdGlvbiAoKSB7ICRyb290U2NvcGUuJGJyb2FkY2FzdCggJ0VPUCcgKTsgfVxyXG5cdFx0fSxcclxuXHJcblx0fTtcclxuXHJcblx0cmV0dXJuIEVWVDtcclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckd2luZG93JywgJ0VOR0lORScsICd1dGlsJywgZnVuY3Rpb24gKCAkd2luZG93LCBFTkdJTkUsIHV0aWwgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcblxuXHRcdEVOR0lORS5hdHRhY2hSZW5kZXJlciggJGVsZW1lbnQgKTtcclxuXHRcdCQoICR3aW5kb3cgKS5vbiggJ3Jlc2l6ZScsIHV0aWwuZGVib3VuY2UoIEVOR0lORS5vbldpbmRvd1Jlc2l6ZSwgMTAwICkgKVxyXG5cdFx0JGVsZW1lbnQub24oICd3aGVlbCcsIGZ1bmN0aW9uICggZXZ0ICkge1xuXHRcdFx0RU5HSU5FLiQkLndoZWVsX2R5ID0gLU1hdGguc2lnbiggZXZ0Lm9yaWdpbmFsRXZlbnQuZGVsdGFZICk7XG5cdFx0fSApO1xuXHJcblx0XHRFTkdJTkUuc3RhcnQoKTtcblxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZXN0cmljdDogJ0UnLFxuXHRcdHJlcGxhY2U6IHRydWUsXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHR0ZW1wbGF0ZTogJzxkaXYgaWQ9XCJjYW52YXMtY29udGFpbmVyXCI+PC9kaXY+J1xuXHR9O1xuXG59IF07XHJcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHdpbmRvdycsIGZ1bmN0aW9uICggJHdpbmRvdyApIHtcblxuXHR2YXIgJCQgPSB7XG5cdFx0Y2FudmFzOiBudWxsLFxuXHRcdHN0YXRzOiBuZXcgU3RhdHMoKSxcblx0XHRzY2VuZTogbmV3IFRIUkVFLlNjZW5lKCksXG5cdFx0d2lkdGg6ICR3aW5kb3cuaW5uZXJXaWR0aCxcblx0XHRoZWlnaHQ6ICR3aW5kb3cuaW5uZXJIZWlnaHQsXG5cdFx0Y2FtZXJhOiBuZXcgVEhSRUUuUGVyc3BlY3RpdmVDYW1lcmEoIDcwLCB0aGlzLndpZHRoIC8gdGhpcy5oZWlnaHQsIDEwLCAxMDAwMDAgKSxcblx0XHRyZW5kZXJlcjogbmV3IFRIUkVFLkNTUzNEUmVuZGVyZXIoKSxcblx0XHRzY3JlZW5fcmF0aW86IHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCxcblx0XHRwaXhlbF9yYXRpbzogJHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDEsXG5cdFx0bW91c2VfeDogdGhpcy53aWR0aCAqIDAuNSxcblx0XHRtb3VzZV95OiB0aGlzLmhlaWdodCAqIDAuNSxcblx0XHR3aGVlbF9keTogMFxuXHR9O1xuXG5cdCQkLnJlbmRlcmVyLnNldFNpemUoICQkLndpZHRoLCAkJC5oZWlnaHQgKTtcblxuXHRmdW5jdGlvbiBhdHRhY2hSZW5kZXJlciggY2FudmFzICkge1xuXHRcdCQkLmNhbnZhcyA9IGNhbnZhcztcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5yZW5kZXJlci5kb21FbGVtZW50ICk7XG5cdFx0Y2FudmFzLmFwcGVuZCggJCQuc3RhdHMuZG9tRWxlbWVudCApO1xuXHR9XG5cblx0ZnVuY3Rpb24gb25XaW5kb3dSZXNpemUoKSB7XG5cdFx0JCQud2lkdGggPSAkd2luZG93LmlubmVyV2lkdGg7XG5cdFx0JCQuaGVpZ2h0ID0gJHdpbmRvdy5pbm5lckhlaWdodDtcblx0XHQkJC5waXhlbF9yYXRpbyA9ICR3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxO1xuXHRcdCQkLnNjcmVlbl9yYXRpbyA9ICQkLndpZHRoIC8gJCQuaGVpZ2h0O1xuXHRcdCQkLmNhbWVyYS5hc3BlY3QgPSAkJC5zY3JlZW5fcmF0aW87XG5cdFx0JCQuY2FtZXJhLnVwZGF0ZVByb2plY3Rpb25NYXRyaXgoKTtcblx0XHQkJC5yZW5kZXJlci5zZXRTaXplKCAkJC53aWR0aCwgJCQuaGVpZ2h0ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBzZXR1cCgpIHtcblxuXHR9XG5cblx0ZnVuY3Rpb24gdXBkYXRlKCkge1xuXG5cdFx0aWYgKCBNYXRoLmFicyggJCQud2hlZWxfZHkgKSA+IDAuMDAxICkge1xuXHRcdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnkgKz0gJCQud2hlZWxfZHkgKiAxLjA7XG5cdFx0XHQkJC5jYW1lcmEucm90YXRlWSggJCQud2hlZWxfZHkgKiAwLjAyNSApO1xuXHRcdFx0JCQud2hlZWxfZHkgKj0gMC45NTtcblx0XHR9XG5cblx0fVxuXG5cdC8vIC0tLS0gIGRyYXcgbG9vcFxuXHRmdW5jdGlvbiBydW4oKSB7XG5cblx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoIHJ1biApO1xuXHRcdHVwZGF0ZSgpO1xuXHRcdCQkLnJlbmRlcmVyLnJlbmRlciggJCQuc2NlbmUsICQkLmNhbWVyYSApO1xuXHRcdCQkLnN0YXRzLnVwZGF0ZSgpO1xuXG5cdH1cblxuXHRmdW5jdGlvbiBzdGFydCgpIHtcblx0XHRzZXR1cCgpO1xuXHRcdHJ1bigpO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVzZXRDYW1lcmEoKSB7XG5cdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnNldCggMCwgMCwgMCApO1xuXHRcdCQkLmNhbWVyYS5yb3RhdGlvbi5zZXQoIDAsIDAsIDAgKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0JCQsXG5cdFx0YXR0YWNoUmVuZGVyZXIsXG5cdFx0b25XaW5kb3dSZXNpemUsXG5cdFx0c3RhcnQsXG5cdFx0cmVzZXRDYW1lcmEsXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5HSU5FJywgJyRjb21waWxlJywgJyRyb290U2NvcGUnLFxyXG5mdW5jdGlvbiAoIGxvZywgRU5HSU5FLCAkY29tcGlsZSwgJHJvb3RTY29wZSApIHtcclxuXG5cdHZhciBhbGxQb3N0ZXJzID0gbmV3IFRIUkVFLk9iamVjdDNEKCk7XG5cdEVOR0lORS4kJC5zY2VuZS5hZGQoIGFsbFBvc3RlcnMgKTtcblxuXHRmdW5jdGlvbiBtYWtlSGVsaXhQb3N0ZXJzKCBwb3N0ZXJPYmplY3RNdWx0aSwgb2Zmc2V0U3RhcnRJZHggKSB7XG5cclxuXHRcdHZhciB2ZWN0b3IgPSBuZXcgVEhSRUUuVmVjdG9yMygpO1xyXG5cdFx0dmFyIHJhZGl1cyA9IDkwMDtcclxuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IHBvc3Rlck9iamVjdE11bHRpLmxlbmd0aDsgaSsrICkge1xuXG5cdFx0XHR2YXIgJGlzb2xhdGVkU2NvcGUgPSAkcm9vdFNjb3BlLiRuZXcoIHRydWUgKTtcblx0XHRcdCRpc29sYXRlZFNjb3BlLm1vdmllSXRlbSA9IHBvc3Rlck9iamVjdE11bHRpWyBpIF07XHJcblxyXG5cdFx0XHR2YXIgcG9zdGVyRGlyZWN0aXZlRWxlbSA9ICRjb21waWxlKCAnPHBvc3Rlcj48L3Bvc3Rlcj4nICkoICRpc29sYXRlZFNjb3BlIClbIDAgXTtcblx0XHRcdHZhciBjc3MzZE9iaiA9IG5ldyBUSFJFRS5DU1MzRE9iamVjdCggcG9zdGVyRGlyZWN0aXZlRWxlbSApO1xyXG5cclxuXHRcdFx0Ly8gdGFnIGFsb2cgYW4gaXNvbGF0ZWRTY29wZSB0byBiZSBkZXN0cm95IHdoZW4gZGlzcG9zZSBhbiBlbGVtZW50XHJcblx0XHRcdGNzczNkT2JqLnNjb3BlID0gJGlzb2xhdGVkU2NvcGU7XHJcblxyXG5cdFx0XHR2YXIgaGlkeCA9IGkgKyBvZmZzZXRTdGFydElkeDtcblx0XHRcdHZhciBwaGkgPSBoaWR4ICogMC4xNzUgKyBNYXRoLlBJO1xyXG5cdFx0XHRjc3MzZE9iai5wb3NpdGlvbi54ID0gLSByYWRpdXMgKiBNYXRoLnNpbiggcGhpICk7XHJcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnkgPSAtICggaGlkeCAqIDggKSArIDIwMDtcclxuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueiA9IHJhZGl1cyAqIE1hdGguY29zKCBwaGkgKTtcclxuXHJcblx0XHRcdHZlY3Rvci5zZXQoIC1jc3MzZE9iai5wb3NpdGlvbi54ICogMiwgY3NzM2RPYmoucG9zaXRpb24ueSwgLWNzczNkT2JqLnBvc2l0aW9uLnogKiAyICk7XHJcblxuXHRcdFx0Y3NzM2RPYmoubG9va0F0KCB2ZWN0b3IgKTtcclxuXHRcdFx0YWxsUG9zdGVycy5hZGQoIGNzczNkT2JqICk7XG5cblx0XHR9XG5cblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ2N1cnIgcG9zdGVyczonLCBhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCApO1xyXG5cclxuXHR9XG5cblx0ZnVuY3Rpb24gY2xlYXJBbGwoKSB7XHJcblx0XHRhbGxQb3N0ZXJzLmNoaWxkcmVuLmZvckVhY2goIGZ1bmN0aW9uICggcG9zdGVyICkge1xyXG5cdFx0XHRwb3N0ZXIuZGlzcG9zZUVsZW1lbnQoKTtcclxuXHRcdFx0cG9zdGVyLnNjb3BlLiRkZXN0cm95KCk7XHJcblx0XHR9ICk7XHJcblx0XHRhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCA9IDA7IC8vIGNsZWFyIGl0ZW1zXHJcblx0fVxyXG5cblx0cmV0dXJuIHtcblx0XHRtYWtlSGVsaXhQb3N0ZXJzLFxuXHRcdGNsZWFyQWxsXG5cdH07XG5cbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCBmdW5jdGlvbiAoICRzdGF0ZSApIHtcclxuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQgKSB7XG5cclxuXHRcdC8vICRzY29wZS5tb3ZpZUl0ZW0gb2JqIGlzIHBhc3NlZCB0aHJ1IGlzb2xhdGVkU2NvcGUgdmlhIGNvbXBpbGVkIGRpcmVjdGl2ZSBpbiBoZWxpeC5mYWMuanNcclxuXHJcblx0XHR2YXIgaW1nID0gbmV3IEltYWdlKCk7XHJcblx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3AvdzE1NC8nICsgJHNjb3BlLm1vdmllSXRlbS5wb3N0ZXJfcGF0aDtcclxuXHRcdGltZy5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7XHJcblxyXG5cdFx0XHQvLyB0b2RvIG1vdmUgY3NzIGludG8gc2FzcywgdXNlIGNsYXNzIGluc3RlYWRcclxuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XHJcblx0XHRcdFx0J3dpZHRoJzogJzE1MHB4JyxcclxuXHRcdFx0XHQnaGVpZ2h0JzogJzIzMHB4JyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1yZXBlYXQnOiAnbm8tcmVwZWF0JyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1zaXplJzogJzE1MHB4IDIzMHB4JyxcclxuXHRcdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJyxcclxuXHRcdFx0XHQnZGlzcGxheSc6ICdub25lJyAvLyByZXF1aXJlZCBmb3IgZmFkZUluIGFuaW1hdGlvblxyXG5cdFx0XHR9ICk7XHJcblx0XHRcdCRlbGVtZW50LmZhZGVJbiggMTUwMCApO1xyXG5cclxuXHRcdH07XHJcblx0XHRpbWcuc3JjID0gaW1nVXJsO1xyXG5cblx0XHQkZWxlbWVudC5vbiggJ2NsaWNrJywgZnVuY3Rpb24gKCBldnQgKSB7XHJcblx0XHRcdCRzdGF0ZS5nbyggJ21vdmllRGV0YWlsJywgeyBtb3ZpZUlkOiAkc2NvcGUubW92aWVJdGVtLmlkIH0gKTtcclxuXHRcdH0gKTtcblxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZXN0cmljdDogJ0UnLFxuXHRcdHJlcGxhY2U6IHRydWUsXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHR0ZW1wbGF0ZTogJzxkaXYgY2xhc3M9XCJwb3N0ZXJFbGVtXCI+PC9kaXY+J1xuXHR9O1xuXG59IF07XHJcbiIsImFuZ3VsYXIubW9kdWxlKCAnYXBwJywgW1xuXHQndWkucm91dGVyJyxcblx0J25nQW5pbWF0ZSdcbl0gKVxuLmNvbnN0YW50KCAnRU5EUE9JTlRfVVJJJywgJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMS8nIClcbi5jb25zdGFudCggJ1RNREJfQVBJJywge1xuXHRrZXk6ICczNzRjMDM0MmE2NDA2ZGZlMGFlYjNkZTJlYTA0MmM1OScsXG5cdHVybDogJ2h0dHA6Ly9hcGkudGhlbW92aWVkYi5vcmcvMy8nXG59IClcblxuLnByb3ZpZGVyKCAnbG9nJywgcmVxdWlyZSggJy4vZGVidWcvbG9nLnB2LmpzJyApIClcblxuLmZhY3RvcnkoICd1dGlsJywgcmVxdWlyZSggJy4vdXRpbC5qcycgKSApXG4uY29udHJvbGxlciggJ21haW5DdHJsJywgcmVxdWlyZSggJy4vbWFpbi5jdHJsLmpzJyApIClcbi5mYWN0b3J5KCAnVE1EYicsIHJlcXVpcmUoICcuL1RNRGIuZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnRVZUJywgcmVxdWlyZSggJy4vZXZlbnRzLmZhYy5qcycgKSApXG4uY29udHJvbGxlciggJ21vdmllRGV0YWlsQ3RybCcsIHJlcXVpcmUoICcuL21vdmllRGV0YWlsLmN0cmwuanMnICkgKVxuLmRpcmVjdGl2ZSggJ2Rpc3BsYXknLCByZXF1aXJlKCAnLi9oZWxpeC9kaXNwbGF5LmRpci5qcycgKSApXG4uZmFjdG9yeSggJ0VOR0lORScsIHJlcXVpcmUoICcuL2hlbGl4L2VuZ2luZS5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdoZWxpeCcsIHJlcXVpcmUoICcuL2hlbGl4L2hlbGl4LmZhYy5qcycgKSApXG4uZGlyZWN0aXZlKCAncG9zdGVyJywgcmVxdWlyZSggJy4vaGVsaXgvcG9zdGVyLmRpci5qcycgKSApXG5cbi5jb250cm9sbGVyKCAnc2lnbnVwQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbnVwLmN0cmwuanMnICkgKVxuLmNvbnRyb2xsZXIoICdzaWduaW5DdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWduaW4uY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25vdXRDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdub3V0LmN0cmwuanMnICkgKVxuLmNvbnRyb2xsZXIoICdjb2xsZWN0aW9uQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvY29sbGVjdGlvbi5jdHJsLmpzJyApIClcblxuLmZhY3RvcnkoICdhdXRoJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2F1dGhUb2tlbicsIHJlcXVpcmUoICcuL2F1dGgvYXV0aFRva2VuLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2F1dGhJbnRlcmNlcHRvcicsIHJlcXVpcmUoICcuL2F1dGgvYXV0aEludGVyY2VwdG9yLmZhYy5qcycgKSApXG5cbi5jb25maWcoIFsgJyRzdGF0ZVByb3ZpZGVyJywgJyR1cmxSb3V0ZXJQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJyxcbmZ1bmN0aW9uICggJHN0YXRlUHJvdmlkZXIsICR1cmxSb3V0ZXJQcm92aWRlciwgJGh0dHBQcm92aWRlciApIHtcblxuXHQkdXJsUm91dGVyUHJvdmlkZXIub3RoZXJ3aXNlKCAnLycgKTtcblxuXHQkc3RhdGVQcm92aWRlclxuXHRcdC5zdGF0ZSggJ2hvbWUnLCB7XG5cdFx0XHR1cmw6ICcvJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9ob21lLmh0bWwnXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnbW92aWVEZXRhaWwnLCB7XG5cdFx0XHR1cmw6ICcvbW92aWUvOm1vdmllSWQnLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL21vdmllLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ21vdmllRGV0YWlsQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdtZCcsXG5cdFx0XHRyZXNvbHZlOiB7XG5cdFx0XHRcdG1vdmllSXRlbTogWyAnJHN0YXRlUGFyYW1zJywgJ1RNRGInLCBmdW5jdGlvbiAoICRzdGF0ZVBhcmFtcywgVE1EYiApIHtcblx0XHRcdFx0XHRyZXR1cm4gVE1EYi5zZWFyY2hCeUlkKCAkc3RhdGVQYXJhbXMubW92aWVJZCApO1xuXHRcdFx0XHR9XVxuXHRcdFx0fVxuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ251cCcsIHtcblx0XHRcdHVybDogJy9zaWdudXAnLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL3NpZ251cC5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdudXBDdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ251cCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWduaW4nLCB7XG5cdFx0XHR1cmw6ICcvc2lnbmluJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9zaWduaW4uaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbmluQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdzaWduaW4nXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbm91dCcsIHtcblx0XHRcdHVybDogJy9zaWdub3V0Jyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdub3V0Q3RybCdcblx0XHR9IClcblx0XHQuc3RhdGUoJ2NvbGxlY3Rpb24nLCB7XG5cdFx0XHR1cmw6ICcvY29sbGVjdGlvbicsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvY29sbGVjdGlvbi5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdjb2xsZWN0aW9uQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdjb2xsJyxcblx0XHRcdHJlc29sdmU6IHtcblx0XHRcdFx0YXV0aG9yaXplOiBbICdhdXRoJywgZnVuY3Rpb24gKCBhdXRoICkge1xuXHRcdFx0XHRcdHJldHVybiBhdXRoLmF1dGhvcml6ZSgpO1xuXHRcdFx0XHR9IF1cblx0XHRcdH1cblx0XHR9KVxuXHQ7XG5cblx0JGh0dHBQcm92aWRlci5pbnRlcmNlcHRvcnMucHVzaCggJ2F1dGhJbnRlcmNlcHRvcicgKTtcblxufSBdIClcbi5ydW4oIFsgJ2xvZycsICckcm9vdFNjb3BlJywgJyRzdGF0ZScsICdhdXRoJywgZnVuY3Rpb24gKCBsb2csICRyb290U2NvcGUsICRzdGF0ZSwgYXV0aCApIHtcblxuXHQvLyB0b2RvIGF1dGhvcml6ZSB1c2VyIGV2ZXJ5IGJlZ2lubmluZyBvZiBzZXNzaW9uXG5cdGF1dGguYXV0aG9yaXplKCB0cnVlICk7XG5cblx0JHJvb3RTY29wZS4kb24oICckc3RhdGVDaGFuZ2VFcnJvcicsIGZ1bmN0aW9uICggZXZlbnQsIHRvU3RhdGUsIHRvUGFyYW1zLCBmcm9tU3RhdGUsIGZyb21QYXJhbXMsIGVycm9yICkge1xuXG5cdFx0ZXZlbnQucHJldmVudERlZmF1bHQoKTsgLy8gcHJldmVudCB0cmFuc2l0aW9uXG5cdFx0bG9nLmRlYnVnKCAnd2FybicsIGVycm9yICk7XG5cdFx0aWYgKCBlcnJvciApIHtcblx0XHRcdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcblx0XHR9XG5cblx0fSApO1xuXG59IF0gKVxuLmNvbmZpZyggWyAnbG9nUHJvdmlkZXInLCAnJGh0dHBQcm92aWRlcicsIGZ1bmN0aW9uICggbG9nUHJvdmlkZXIsICRodHRwUHJvdmlkZXIgKSB7XG5cblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWcoKTtcblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWdOYW1lc3BhY2UoICdpbmZvJywgJ2VycicsICdhdXRoJyApOyAvLyBjdHJsXG5cblx0JGh0dHBQcm92aWRlci51c2VMZWdhY3lQcm9taXNlRXh0ZW5zaW9ucyggZmFsc2UgKTtcblxufSBdIClcbjtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdUTURiJywgJ0VWVCcsICdoZWxpeCcsICdFTkdJTkUnLFxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgVE1EYiwgRVZULCBoZWxpeCwgRU5HSU5FICkge1xuXG5cdHZhciB2bSA9IHRoaXM7XG5cdHZtLnNlYXJjaCA9IHtcblx0XHRxdWVyeTogJycsXG5cdH07XG5cdHZtLm1vdmllSXRlbXMgPSBudWxsO1xuXG5cdCRzY29wZS4kd2F0Y2goIFRNRGIuZ2V0UmVzLCBmdW5jdGlvbiAoIG1vdkl0ZW1zICkge1xuXG5cdFx0dm0ubW92aWVJdGVtcyA9IG1vdkl0ZW1zO1xuXHRcdGhlbGl4Lm1ha2VIZWxpeFBvc3RlcnMoIG1vdkl0ZW1zLnNsaWNlKCBUTURiLnByZXZSZXN1bHRMZW4gKSwgVE1EYi5wcmV2UmVzdWx0TGVuICk7XG5cblx0fSwgdHJ1ZSApO1xuXG5cdHZhciBwcmV2UXVlcnkgPSAnJztcblx0dm0uc2VhcmNoID0gZnVuY3Rpb24gKCkge1xuXHRcdGlmICggdm0uc2VhcmNoLnF1ZXJ5ID09PSAnJyApIHJldHVybjtcblx0XHRpZiAoIHByZXZRdWVyeSAhPT0gdm0uc2VhcmNoLnF1ZXJ5ICkge1xuXHRcdFx0cHJldlF1ZXJ5ID0gdm0uc2VhcmNoLnF1ZXJ5O1xuXHRcdFx0VE1EYi5jbGVhclNlYXJjaCgpO1xuXHRcdFx0aGVsaXguY2xlYXJBbGwoKTtcblx0XHRcdEVOR0lORS5yZXNldENhbWVyYSgpO1xuXHRcdH1cblx0XHRUTURiLnNlYXJjaEJ5VGl0bGUoIHZtLnNlYXJjaCApO1xuXHR9O1xuXG5cdC8vIERFQlVHXG5cdHdpbmRvdy5TQ09QRSA9ICRzY29wZTtcblx0dm0uVE1EYiA9IFRNRGI7XG5cdHZtLmhlbGl4ID0gaGVsaXg7XG5cdHZtLkVOR0lORSA9IEVOR0lORTtcblxuXHRFVlQuRU9QLmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAncmVjaWV2ZWQgRU9QIGV2ZW50IScgKTtcblx0fSApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnVE1EYicsICckY2FjaGVGYWN0b3J5JywgJ21vdmllSXRlbScsXHJcbmZ1bmN0aW9uKCBsb2csICRzY29wZSwgVE1EYiwgJGNhY2hlRmFjdG9yeSwgbW92aWVJdGVtICkge1xyXG5cclxuXHR2YXIgdm0gPSB0aGlzO1xyXG5cdHZtLm1vdmllSXRlbSA9IG1vdmllSXRlbTsgLy8gbW92aWVJdGVtIGluamVjdGVkIHZpYSBzdGF0ZSByZXNvbHZlXHJcblx0bG9nLmRlYnVnKCAnY3RybCcsICdtb3ZpZURldGFpbCBjdHJsIHJlc29sdmVkOicsIHZtLm1vdmllSXRlbSApO1xyXG5cclxuXHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlO1xyXG5cdGlmICggbW92aWVJdGVtLnRpdGxlICE9PSBtb3ZpZUl0ZW0ub3JpZ2luYWxfdGl0bGUgKSB7XHJcblx0XHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlICsgJyAoJyArIG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSArICcpJztcclxuXHR9XHJcblxyXG5cdGlmICggbW92aWVJdGVtLmJhY2tkcm9wX3BhdGggKSB7XHJcblx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3Avb3JpZ2luYWwnICsgbW92aWVJdGVtLmJhY2tkcm9wX3BhdGg7XHJcblx0XHQkKCAnLmJhY2tkcm9wJyApLmNzcygge1xyXG5cdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJ1xyXG5cdFx0fSApO1xyXG5cdH1cclxuXHJcbn0gXTtcclxuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcclxuXHJcblx0ZnVuY3Rpb24gZGVib3VuY2UoIGZ1bmMsIHdhaXQsIGltbWVkaWF0ZSApIHtcclxuXHRcdHZhciBfdGhpcyA9IHRoaXMsXHJcblx0XHRcdF9hcmd1bWVudHMgPSBhcmd1bWVudHM7XHJcblxyXG5cdFx0dmFyIHRpbWVvdXQ7XHJcblx0XHRyZXR1cm4gZnVuY3Rpb24gKCkge1xyXG5cclxuXHRcdFx0dmFyIGNvbnRleHQgPSBfdGhpcyxcclxuXHRcdFx0XHRhcmdzID0gX2FyZ3VtZW50cztcclxuXHRcdFx0dmFyIGxhdGVyID0gZnVuY3Rpb24gbGF0ZXIoKSB7XHJcblxyXG5cdFx0XHRcdHRpbWVvdXQgPSBudWxsO1xyXG5cdFx0XHRcdGlmICggIWltbWVkaWF0ZSApIGZ1bmMuYXBwbHkoIGNvbnRleHQsIGFyZ3MgKTtcclxuXHRcdFx0fTtcclxuXHRcdFx0dmFyIGNhbGxOb3cgPSBpbW1lZGlhdGUgJiYgIXRpbWVvdXQ7XHJcblx0XHRcdGNsZWFyVGltZW91dCggdGltZW91dCApO1xyXG5cdFx0XHR0aW1lb3V0ID0gc2V0VGltZW91dCggbGF0ZXIsIHdhaXQgKTtcclxuXHRcdFx0aWYgKCBjYWxsTm93ICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xyXG5cdFx0fTtcclxuXHR9XHJcblxyXG5cdHJldHVybiB7XHJcblx0XHRkZWJvdW5jZVxyXG5cdH07XHJcblxyXG59IF07XHJcbiJdfQ==
