(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
'use strict';

module.exports = ['log', '$http', 'TMDB_API', 'EVT', '$cacheFactory', '$q', 'ENDPOINT_URI', function (log, $http, TMDB_API, EVT, $cacheFactory, $q, ENDPOINT_URI) {

	var searchResult = [];
	var totalPages = -1;
	var currPage = 1;

	var movieIdCache = $cacheFactory('movieIdCache');
	// TMDB_API.url + 'movie/now_playing'

	var DB_ENDPOINT = ENDPOINT_URI + 'movie/';

	function putItemToDB(movieItem) {
		$http.put(DB_ENDPOINT + movieItem.id, movieItem).then(function (res) {
			log.debug('api', 'PUT:', res);
		}, function (err) {
			log.debug('err', 'PUT:', err);
		});
	}

	function searchIdFromDB(id) {
		var promise = $http.get(DB_ENDPOINT + id).then(function (res) {
			log.debug('api', 'searchById => DB:', res.data);
			if (res.data) {
				movieIdCache.put(res.data.id, res.data);
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
			log.debug('api', 'searchById => API:', res.data);
			movieIdCache.put(res.data.id, res.data);
			putItemToDB(res.data);
			return res.data;
		}, function (err) {
			log.debug('err', 'searchById => API:', err);
		});
		return promise;
	}

	function searchById(id) {

		var df_DB = $q.defer();
		var df_Res = $q.defer();

		var cachedItem = movieIdCache.get(id);
		if (cachedItem) {
			log.debug('api', 'searchById => cache:', cachedItem);
			df_Res.resolve(cachedItem);
			return df_Res.promise;
		}

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

		$http.get(TMDB_API.url + 'search/movie', {
			cache: true,
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
			log.debug('api', 'searchByTitle:', res, res.data);

			// cache
			res.data.results.forEach(function (item) {

				if (!movieIdCache.get(item.id)) {
					log.debug('api', item.id, item);
					movieIdCache.put(item.id, item);
				}
			});
		}, function (err) {
			// emit event search err
			log.debug('err', 'searchByTitle:', err);
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
		totalPages = -1;
		currPage = 1;
	}

	return {
		searchByTitle: searchByTitle,
		searchById: searchById,
		clearSearch: clearSearch,
		getRes: getRes,
		putItemToDB: putItemToDB,
		movieIdCache: movieIdCache
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

			deferred.resolve(true);
		} else {

			$http.get(ENDPOINT_URI + 'auth', { requireAuth: true }).then(function (res) {

				log.debug('auth', 'auth.authorize():', res, res.data);
				identity = res.data;
				_identityResolved = true;
				deferred.resolve(true);
			}, function (err) {

				log.debug('err', 'authorize', err, err.data);
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

		if (config.requireAuth) {
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
		log.debug('auth', 'token removed');
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

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {
		email: '',
		password: ''
	};

	vm.signin = function () {

		if (vm.user.email === '' || vm.user.password === '') {
			log.debug('auth', 'email & password required.');
			return;
		}

		$http.post(ENDPOINT_URI + 'signin', vm.user).then(function (res) {
			log.debug('auth', 'signin', res, res.data);
			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err, status) {
			log.debug('err', 'signin', err);
		});
	};
}];

},{}],6:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'auth', 'movieCollection', function ($state, auth, movieCollection) {

	auth.deauthorize();
	movieCollection._clear();
	$state.go('signin');
}];

},{}],7:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', '$http', 'ENDPOINT_URI', 'authToken', '$state', function (log, $scope, $http, ENDPOINT_URI, authToken, $state) {

	var vm = this;
	vm.user = {};

	vm.signup = function () {

		if (vm.user.email === undefined || vm.user.password === undefined) {
			log.debug('warn', 'email & password required.');
			return;
		}

		log.debug('auth', 'signing up...');
		$http.post(ENDPOINT_URI + 'signup', vm.user).then(function (res) {

			log.debug('auth', 'Registered.', res);

			authToken.setToken(res.data.token);
			$state.go('collection');
		}, function (err) {

			log.debug('err', err);
			vm.form.$submitted = false;
		});
	};
}];

},{}],8:[function(require,module,exports){
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
		},
		collectionModalOpen: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalOpen', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalOpen');
			}
		},
		collectionModalClose: {
			listen: function listen(cb) {
				$rootScope.$on('collectionModalClose', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('collectionModalClose');
			}
		},
		helixNeedsReset: {
			listen: function listen(cb) {
				$rootScope.$on('helixNeedsReset', cb);
			},
			emit: function emit() {
				$rootScope.$broadcast('helixNeedsReset');
			}
		}

	};

	return EVT;
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
				console.log.apply(console, [debugName].concat(slicedArgs));
			}
		}

		return {
			debug: debug
		};
	};
}];

},{}],10:[function(require,module,exports){
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

},{}],11:[function(require,module,exports){
'use strict';

module.exports = ['$httpProvider', function ($httpProvider) {
	$httpProvider.interceptors.push('authInterceptor');
}];

},{}],12:[function(require,module,exports){
'use strict';

module.exports = ['logProvider', '$httpProvider', function (logProvider, $httpProvider) {

	logProvider.enableDebug();
	// logProvider.enableDebugNamespace( 'info', 'err', 'auth', 'api', 'collection' );
	logProvider.enableDebugNamespace('info', 'err');

	$httpProvider.useLegacyPromiseExtensions(false);
}];

},{}],13:[function(require,module,exports){
'use strict';

module.exports = ['$stateProvider', '$urlRouterProvider', '$httpProvider', function ($stateProvider, $urlRouterProvider, $httpProvider) {

	$urlRouterProvider.otherwise('/');

	$stateProvider.state('helix', {
		url: '/',
		templateUrl: './template/helix.html'
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
	}).state('movieDetail', {
		url: '/movie/:movieId',
		templateUrl: './template/movieDetail.html',
		controller: 'movieDetailCtrl',
		controllerAs: 'md',
		resolve: {
			movieItem: ['$stateParams', 'TMDb', function ($stateParams, TMDb) {
				return TMDb.searchById($stateParams.movieId);
			}]
		}
	}).state('collection', {
		url: '/collection',
		templateUrl: './template/collection.html',
		controller: 'movieCollectionCtrl',
		controllerAs: 'mc',
		resolve: {
			authorize: ['auth', function (auth) {
				return auth.authorize();
			}],
			resolvedCollection: ['movieCollection', function (movieCollection) {
				return movieCollection.resolveCollection();
			}]
		}
	});
}];

},{}],14:[function(require,module,exports){
'use strict';

module.exports = [function () {

	function link($scope, $element, $attrs) {

		$element.on('mouseenter', function () {
			$element.removeClass($attrs.leave);
			$element.addClass($attrs.hover);
		}).on('mouseleave', function () {
			$element.removeClass($attrs.hover);
			$element.addClass($attrs.leave);
		});
	}

	return {
		restrict: 'A',
		link: link
	};
}];

},{}],15:[function(require,module,exports){
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

},{}],16:[function(require,module,exports){
'use strict';

module.exports = ['$window', function ($window) {

	var $$ = {
		canvas: null,
		stats: new Stats(),
		scene: new THREE.Scene(),
		width: $(window).width(),
		height: $(window).height(),
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
		$$.width = $(window).width();
		$$.height = $(window).height();
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

},{}],17:[function(require,module,exports){
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

},{}],18:[function(require,module,exports){
'use strict';

module.exports = ['$state', 'collectionModalService', function ($state, collectionModalService) {

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
			collectionModalService.setActiveItem($scope.movieItem);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		controller: ctrl,
		template: '<div class="posterElem"></div>'
	};
}];

},{}],19:[function(require,module,exports){
'use strict';

angular.module('app', ['ui.router', 'ngAnimate']).constant('ENDPOINT_URI', 'http://localhost:8001/').constant('TMDB_API', {
	key: '374c0342a6406dfe0aeb3de2ea042c59',
	url: 'http://api.themoviedb.org/3/'
}).provider('log', require('./common/log.pv.js')).factory('util', require('./common/util.js')).factory('EVT', require('./common/events.fac.js')).factory('TMDb', require('./API/TMDb.fac.js')).controller('mainCtrl', require('./main.ctrl.js')).factory('ENGINE', require('./helix/engine.fac.js')).factory('helix', require('./helix/helix.fac.js')).directive('display', require('./helix/display.dir.js')).directive('poster', require('./helix/poster.dir.js')).controller('movieDetailCtrl', require('./movieDetail.ctrl.js')).factory('auth', require('./auth/auth.fac.js')).factory('authToken', require('./auth/authToken.fac.js')).factory('authInterceptor', require('./auth/authInterceptor.fac.js')).controller('signupCtrl', require('./auth/signup.ctrl.js')).controller('signinCtrl', require('./auth/signin.ctrl.js')).controller('signoutCtrl', require('./auth/signout.ctrl.js')).controller('movieCollectionCtrl', require('./movieCollection/movieCollection.ctrl.js')).factory('movieCollection', require('./movieCollection/movieCollection.fac.js')).factory('collectionModalService', require('./movieCollection/collectionModalService.fac.js')).directive('collectionModal', require('./movieCollection/collectionModal.dir.js')).directive('collectionItem', require('./movieCollection/collectionItem.dir.js')).directive('hoverClass', require('./directive/hoverClass.dir.js')).config(require('./config/routeConfig.js')).config(require('./config/logConfig.js')).config(require('./config/httpConfig.js')).run(['log', '$rootScope', '$state', 'auth', 'movieCollection', function (log, $rootScope, $state, auth, movieCollection) {

	auth.authorize(true);

	movieCollection.resolveCollection();

	$rootScope.$on('$stateChangeError', function (event, toState, toParams, fromState, fromParams, error) {

		event.preventDefault(); // prevent transition
		log.debug('warn', error);
		if (error) {
			$state.go('signin');
		}
	});
}]);

},{"./API/TMDb.fac.js":1,"./auth/auth.fac.js":2,"./auth/authInterceptor.fac.js":3,"./auth/authToken.fac.js":4,"./auth/signin.ctrl.js":5,"./auth/signout.ctrl.js":6,"./auth/signup.ctrl.js":7,"./common/events.fac.js":8,"./common/log.pv.js":9,"./common/util.js":10,"./config/httpConfig.js":11,"./config/logConfig.js":12,"./config/routeConfig.js":13,"./directive/hoverClass.dir.js":14,"./helix/display.dir.js":15,"./helix/engine.fac.js":16,"./helix/helix.fac.js":17,"./helix/poster.dir.js":18,"./main.ctrl.js":20,"./movieCollection/collectionItem.dir.js":21,"./movieCollection/collectionModal.dir.js":22,"./movieCollection/collectionModalService.fac.js":23,"./movieCollection/movieCollection.ctrl.js":24,"./movieCollection/movieCollection.fac.js":25,"./movieDetail.ctrl.js":26}],20:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', 'EVT', 'helix', 'ENGINE', 'auth', '$state', '$rootScope', function (log, $scope, TMDb, EVT, helix, ENGINE, auth, $state, $rootScope) {

	var vm = this;
	vm.auth = auth;
	vm.search = {
		query: ''
	};
	vm.movieItems = null;

	$scope.$watch(TMDb.getRes, function (movItems, oldMovItems) {

		vm.movieItems = movItems;
		helix.makeHelixPosters(movItems.slice(oldMovItems.length), oldMovItems.length);
	}, true);

	var prevQuery = '';
	var helixNeedsReset = false;
	EVT.helixNeedsReset.listen(function () {
		helixNeedsReset = true;
	});

	vm.search = function () {
		if (vm.search.query === '') return;
		if (prevQuery !== vm.search.query || helixNeedsReset) {
			prevQuery = vm.search.query;
			TMDb.clearSearch();
			helix.clearAll();
			ENGINE.resetCamera();
			helixNeedsReset = false;
		}
		if ($state.current.name !== 'helix') {
			$state.go('helix');
		}
		TMDb.searchByTitle(vm.search);
	};

	// DEBUG
	window.SCOPE = $scope;
	vm.TMDb = TMDb;
	vm.helix = helix;
	vm.ENGINE = ENGINE;
	vm.STATE = $state;

	EVT.EOP.listen(function () {
		log.debug('info', 'recieved EOP event!');
	});
}];

},{}],21:[function(require,module,exports){
'use strict';

module.exports = ['log', 'TMDb', function (log, TMDb) {

	function ctrl($scope, $attrs, $element) {

		TMDb.searchById(parseInt($scope.movieId)).then(function (res) {

			// log.debug( 'info', 'collectionItemDirective', res );
			var imgUrl = 'http://image.tmdb.org/t/p/w92/' + res.poster_path;
			$element.css({
				'width': '100%',
				'height': '100%',
				'background-repeat': 'no-repeat',
				'background-size': '100% 100%',
				'background-image': 'url(' + imgUrl + ')'
			});
		}, function (err) {
			log.debug('err', 'collectionItemDirective', err);
		});
	}

	return {
		restrict: 'E',
		replace: true,
		scope: { movieId: '@' },
		controller: ctrl,
		controllerAs: 'ci',
		template: '<div></div>'
	};
}];

},{}],22:[function(require,module,exports){
'use strict';

module.exports = ['log', 'movieCollection', 'collectionModalService', 'EVT', function (log, movieCollection, collectionModalService, EVT) {

	function ctrl($scope, $element, $attrs) {

		var vm = this;
		vm.movieCollection = movieCollection;
		vm.collectionModalService = collectionModalService;

		vm.addingNewCollection = false;

		vm.openEditor = function () {
			vm.addingNewCollection = true;
		};

		vm.closeEditor = function () {
			vm.addingNewCollection = false;
		};

		vm.createNewCollection = function () {
			movieCollection.create($scope.newCollectionName);
			$scope.newCollectionName = '';
			vm.closeEditor();
		};

		vm.addToCollection = function (movieId, collectionName) {
			log.debug('collection', 'addToCollection:', movieId, collectionName);
			var success = movieCollection.push(movieId, collectionName);
			log.debug('collection', 'movieCollection.push', success);
		};

		vm.closeModal = function () {
			vm.addingNewCollection = false;
			$scope.newCollectionName = '';
			collectionModalService.close();
		};

		// default css at directive initialization
		$element.css({ visibility: 'hidden' });

		EVT.collectionModalOpen.listen(function () {
			log.debug('collection', 'collectionModalOpen');
			$element.css({ visibility: 'visible' });
		});

		EVT.collectionModalClose.listen(function () {
			log.debug('collection', 'collectionModalClose');
			$element.css({ visibility: 'hidden' });
		});
	}

	return {

		restrict: 'E',
		scope: {},
		controller: ctrl,
		controllerAs: 'modal',
		replace: true,
		templateUrl: './template/collectionModal.html'

	};
}];

},{}],23:[function(require,module,exports){
'use strict';

module.exports = ['log', 'EVT', 'auth', '$state', function (log, EVT, auth, $state) {

	var activeItem = null;

	function setActiveItem(item) {
		activeItem = item;
	}

	function getActiveItem(item) {
		return activeItem;
	}

	function open() {
		if (auth.isAuthenticated()) {
			EVT.collectionModalOpen.emit();
		} else {
			$state.go('signin');
		}
	}

	function close() {
		EVT.collectionModalClose.emit();
	}

	return {
		setActiveItem: setActiveItem,
		getActiveItem: getActiveItem,
		open: open,
		close: close
	};
}];

},{}],24:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'auth', 'movieCollection', 'TMDb', 'helix', 'ENGINE', '$state', 'EVT', function (log, $scope, auth, movieCollection, TMDb, helix, ENGINE, $state, EVT) {

	log.debug('collection', 'collectionCtrl', movieCollection.getCollection());
	var vm = this;
	vm.movieCollection = movieCollection;

	vm.viewCollection = function (collection) {

		log.debug('info', 'viewCollection =>', collection);

		var loadedItems = 0;
		var totalItems = collection.movies.length;
		var allMovies = [];

		collection.movies.forEach(function (movieId) {

			TMDb.searchById(movieId).then(function (res) {
				allMovies.push(res);
			}, function (err) {
				log.debug('err', 'viewCollection =>', err);
			})['finally'](function () {
				if (++loadedItems === totalItems) {

					helix.clearAll();
					ENGINE.resetCamera();
					helix.makeHelixPosters(allMovies, 0);
					$state.go('helix');
					TMDb.clearSearch();
					EVT.helixNeedsReset.emit();
				}
			});
		});
	};
}];

},{}],25:[function(require,module,exports){
'use strict';

module.exports = ['log', 'ENDPOINT_URI', '$http', '$q', function (log, ENDPOINT_URI, $http, $q) {

	var DB_ENDPOINT = ENDPOINT_URI + 'collection';
	var collection = null;

	var fullCollection = null;

	function create(name) {
		collection.push({ collectionName: name, movies: [] });
		put();
	}

	function isEmpty() {
		return collection.length === 0;
	}

	function resolveCollection() {

		var deferred = $q.defer();

		if (collection !== null) {
			deferred.resolve(collection);
		} else {
			$http.get(DB_ENDPOINT, { requireAuth: true }).then(function (res) {
				log.debug('collection', 'collection.resolveCollection():', res);
				if (res.data) {
					collection = res.data;
				} else {
					collection = [];
				}
				deferred.resolve(true);
			}, function (err) {
				log.debug('err', 'collection.resolveCollection():', err);
				deferred.reject(err);
			});
		}

		return deferred.promise;
	}

	function hasItem(itemId, someCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === someCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						return true;
					}
				}
			}
		}
		return false;
	}

	function put() {
		$http.put(DB_ENDPOINT, collection, { requireAuth: true }).then(function (res) {
			log.debug('collection', 'collection.put():', res);
		}, function (err) {
			log.debug('err', 'collection.put():', err);
		});
	}

	function push(itemId, toCollection) {
		if (hasItem(itemId, toCollection)) {
			return false;
		}
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === toCollection) {
				collection[i].movies.push(itemId);
				put();
				return true;
			}
		}
		return false;
	}

	function remove(itemId, inCollection) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === inCollection) {
				for (var k = 0; k < collection[i].movies.length; k++) {
					if (collection[i].movies[k] === itemId) {
						var removed = collection[i].movies.splice(k, 1).length;
						put();
						return removed !== 0;
					}
				}
			}
		}
		return false;
	}

	function removeCollection(collectionName) {
		for (var i = 0; i < collection.length; i++) {
			if (collection[i].collectionName === collectionName) {
				var removed = collection.splice(i, 1).length;
				put();
				return removed !== 0;
			}
		}
		return false;
	}

	function sync() {
		// sync local colelction w/ DB
	}

	function getCollection() {
		return collection;
	}

	function _clear() {
		collection = null;
		log.debug('collection', 'local collection cleared.');
	}

	return {
		getCollection: getCollection,
		create: create,
		push: push,
		put: put,
		remove: remove,
		removeCollection: removeCollection,
		sync: sync,
		_clear: _clear,
		resolveCollection: resolveCollection,
		hasItem: hasItem,
		isEmpty: isEmpty
	};
}];

},{}],26:[function(require,module,exports){
'use strict';

module.exports = ['log', '$scope', 'TMDb', '$cacheFactory', 'movieItem', 'collectionModalService', 'movieCollection', function (log, $scope, TMDb, $cacheFactory, movieItem, collectionModalService, movieCollection) {

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

	vm.openCollectionModal = function () {
		collectionModalService.setActiveItem(movieItem);
		collectionModalService.open();
	};
}];

},{}]},{},[19])
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvQVBJL1RNRGIuZmFjLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL2F1dGgvYXV0aC5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL2F1dGgvYXV0aFRva2VuLmZhYy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9hdXRoL3NpZ25pbi5jdHJsLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL2F1dGgvc2lnbnVwLmN0cmwuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvY29tbW9uL2V2ZW50cy5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvY29tbW9uL2xvZy5wdi5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9jb21tb24vdXRpbC5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9jb25maWcvaHR0cENvbmZpZy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9jb25maWcvbG9nQ29uZmlnLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL2NvbmZpZy9yb3V0ZUNvbmZpZy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9kaXJlY3RpdmUvaG92ZXJDbGFzcy5kaXIuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvaGVsaXgvZW5naW5lLmZhYy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9oZWxpeC9oZWxpeC5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9pbmRleC5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9tYWluLmN0cmwuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25JdGVtLmRpci5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsLmRpci5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsU2VydmljZS5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL21vdmllQ29sbGVjdGlvbi9tb3ZpZUNvbGxlY3Rpb24uZmFjLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL21vdmllRGV0YWlsLmN0cmwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQzNGLFVBQVcsR0FBRyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFHOztBQUV2RSxLQUFJLFlBQVksR0FBRyxFQUFFLENBQUM7QUFDdEIsS0FBSSxVQUFVLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFDcEIsS0FBSSxRQUFRLEdBQUcsQ0FBQyxDQUFDOztBQUVqQixLQUFJLFlB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QUFFLGlCQUFpQixFQUNySCxVQUFVLEdBQUcsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLGFBQWEsRUFBRSxTQUFTLEVBQUUsc0JBQXNCLEVBQUUsZUFBZSxFQUFHOztBQUVoRyxLQUFJLEVBQUUsR0FBRyxJQUFJLENBQUM7QUFDZCxHQUFFLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQztBQUN6QixJQUFHLENBQUMsS0FBSyxDQUFFLE1BQU0sRUFBRSw0QkFBNEIsRUFBRSxFQUFFLENBQUMsU0FBUyxDQUFFLENBQUM7O0FBRWhFLFVBQVMsQ0FBQyxTQUFTLEdBQUcsU0FBUyxDQUFDLEtBQUssQ0FBQztBQUN0QyxLQUFLLFNBQVMsQ0FBQyxLQUFLLEtBQUssU0FBUyxDQUFDLGNBQWMsRUFBRztBQUNuRCxXQUFTLENBQUMsU0FBUyxHQUFHLFNBQVMsQ0FBQyxLQUFLLEdBQUcsSUFBSSxHQUFHLFNBQVMsQ0FBQyxjQUFjLEdBQUcsR0FBRyxDQUFDO0VBQzlFOztBQUVELEtBQUssU0FBUyxDQUFDLGFBQWEsRUFBRztBQUM5QixNQUFJLE1BQU0sR0FBRyxvQ0FBb0MsR0FBRyxTQUFTLENBQUMsYUFBYSxDQUFDO0FBQzVFLEdBQUMsQ0FBRSxXQUFXLENBQUUsQ0FBQyxHQUFHLENBQUU7QUFDckIscUJBQWtCLEVBQUUsTUFBTSxHQUFHLE1BQU0sR0FBRyxHQUFHO0dBQ3pDLENBQUUsQ0FBQztFQUNKOztBQUVELEdBQUUsQ0FBQyxtQkFBbUIsR0FBRyxZQUFZO0FBQ3BDLHdCQUFzQixDQUFDLGFBQWEsQ0FBRSxTQUFTLENBQUUsQ0FBQztBQUNsRCx3QkFBc0IsQ0FBQyxJQUFJLEVBQUUsQ0FBQztFQUM5QixDQUFDO0NBRUYsQ0FBRSxDQUFDIiwiZmlsZSI6ImdlbmVyYXRlZC5qcyIsInNvdXJjZVJvb3QiOiIiLCJzb3VyY2VzQ29udGVudCI6WyIoZnVuY3Rpb24gZSh0LG4scil7ZnVuY3Rpb24gcyhvLHUpe2lmKCFuW29dKXtpZighdFtvXSl7dmFyIGE9dHlwZW9mIHJlcXVpcmU9PVwiZnVuY3Rpb25cIiYmcmVxdWlyZTtpZighdSYmYSlyZXR1cm4gYShvLCEwKTtpZihpKXJldHVybiBpKG8sITApO3ZhciBmPW5ldyBFcnJvcihcIkNhbm5vdCBmaW5kIG1vZHVsZSAnXCIrbytcIidcIik7dGhyb3cgZi5jb2RlPVwiTU9EVUxFX05PVF9GT1VORFwiLGZ9dmFyIGw9bltvXT17ZXhwb3J0czp7fX07dFtvXVswXS5jYWxsKGwuZXhwb3J0cyxmdW5jdGlvbihlKXt2YXIgbj10W29dWzFdW2VdO3JldHVybiBzKG4/bjplKX0sbCxsLmV4cG9ydHMsZSx0LG4scil9cmV0dXJuIG5bb10uZXhwb3J0c312YXIgaT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2Zvcih2YXIgbz0wO288ci5sZW5ndGg7bysrKXMocltvXSk7cmV0dXJuIHN9KSIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRodHRwJywgJ1RNREJfQVBJJywgJ0VWVCcsICckY2FjaGVGYWN0b3J5JywgJyRxJywgJ0VORFBPSU5UX1VSSScsXG5mdW5jdGlvbiAoIGxvZywgJGh0dHAsIFRNREJfQVBJLCBFVlQsICRjYWNoZUZhY3RvcnksICRxLCBFTkRQT0lOVF9VUkkgKSB7XG5cblx0dmFyIHNlYXJjaFJlc3VsdCA9IFtdO1xuXHR2YXIgdG90YWxQYWdlcyA9IC0xO1xuXHR2YXIgY3VyclBhZ2UgPSAxO1xuXG5cdHZhciBtb3ZpZUlkQ2FjaGUgPSAkY2FjaGVGYWN0b3J5KCAnbW92aWVJZENhY2hlJyApO1xuXHQvLyBUTURCX0FQSS51cmwgKyAnbW92aWUvbm93X3BsYXlpbmcnXG5cblx0dmFyIERCX0VORFBPSU5UID0gRU5EUE9JTlRfVVJJICsgJ21vdmllLyc7XG5cblx0ZnVuY3Rpb24gcHV0SXRlbVRvREIoIG1vdmllSXRlbSApIHtcblx0XHQkaHR0cC5wdXQoIERCX0VORFBPSU5UICsgbW92aWVJdGVtLmlkLCBtb3ZpZUl0ZW0gKVxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdQVVQ6JywgcmVzICk7XG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnUFVUOicsIGVyciApO1xuXHRcdH0gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHNlYXJjaElkRnJvbURCKCBpZCApIHtcblx0XHR2YXIgcHJvbWlzZSA9ICRodHRwLmdldCggREJfRU5EUE9JTlQgKyBpZCApXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ3NlYXJjaEJ5SWQgPT4gREI6JywgcmVzLmRhdGEgKTtcblx0XHRcdGlmICggcmVzLmRhdGEgKSB7XG5cdFx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIHJlcy5kYXRhLmlkLCByZXMuZGF0YSApO1xuXHRcdFx0XHRyZXR1cm4gcmVzLmRhdGE7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRyZXR1cm4gbnVsbDtcblx0XHRcdH1cblx0XHR9LCBmdW5jdGlvbiggZXJyICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5SWQgPT4gREI6JywgZXJyICk7XG5cdFx0fSApO1xuXHRcdHJldHVybiBwcm9taXNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tQVBJKCBpZCApIHtcblx0XHR2YXIgcHJvbWlzZSA9ICRodHRwLmdldCggVE1EQl9BUEkudXJsICsgJ21vdmllLycgKyBpZCwge1xuXHRcdFx0cGFyYW1zOiB7IGFwaV9rZXk6IFRNREJfQVBJLmtleSB9XG5cdFx0fSApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ3NlYXJjaEJ5SWQgPT4gQVBJOicsIHJlcy5kYXRhICk7XG5cdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCByZXMuZGF0YS5pZCwgcmVzLmRhdGEgKTtcblx0XHRcdHB1dEl0ZW1Ub0RCKCByZXMuZGF0YSApO1xuXHRcdFx0cmV0dXJuIHJlcy5kYXRhO1xuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5SWQgPT4gQVBJOicsIGVyciApO1xuXHRcdH0gKTtcblx0XHRyZXR1cm4gcHJvbWlzZTtcblx0fVxuXG5cdGZ1bmN0aW9uIHNlYXJjaEJ5SWQoIGlkICkge1xuXG5cdFx0dmFyIGRmX0RCID0gJHEuZGVmZXIoKTtcblx0XHR2YXIgZGZfUmVzID0gJHEuZGVmZXIoKTtcblxuXHRcdHZhciBjYWNoZWRJdGVtID0gbW92aWVJZENhY2hlLmdldCggaWQgKTtcblx0XHRpZiAoIGNhY2hlZEl0ZW0gKSB7XG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBjYWNoZTonLCBjYWNoZWRJdGVtICk7XG5cdFx0XHRkZl9SZXMucmVzb2x2ZSggY2FjaGVkSXRlbSApO1xuXHRcdFx0cmV0dXJuIGRmX1Jlcy5wcm9taXNlO1xuXHRcdH1cblxuXHRcdHNlYXJjaElkRnJvbURCKCBpZCApLnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0aWYgKCByZXMgKSB7XG5cdFx0XHRcdGRmX0RCLnJlc29sdmUoIHJlcyApO1xuXHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0ZGZfREIucmVqZWN0KCAnbm90IGZvdW5kJyApO1xuXHRcdFx0fVxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0XHRkZl9EQi5yZWplY3QoIGVyciApO1xuXHRcdH0gKTtcblxuXHRcdGRmX0RCLnByb21pc2UudGhlbiggZnVuY3Rpb24gKCByZXNfREIgKSB7XG5cdFx0XHRkZl9SZXMucmVzb2x2ZSggcmVzX0RCICk7XG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRzZWFyY2hJZEZyb21BUEkoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXNfYXBpICkge1xuXHRcdFx0XHRkZl9SZXMucmVzb2x2ZSggcmVzX2FwaSApO1xuXHRcdFx0fSwgZnVuY3Rpb24gKCBlcnJfYXBpICkge1xuXHRcdFx0XHRkZl9SZXMucmVqZWN0KCBlcnJfYXBpICk7XG5cdFx0XHR9ICk7XG5cdFx0fSApO1xuXG5cdFx0cmV0dXJuIGRmX1Jlcy5wcm9taXNlO1xuXG5cdH1cblxuXHRmdW5jdGlvbiBzZWFyY2hCeVRpdGxlKCBzZWFyY2hPYmogKSB7XG5cblx0XHRpZiAoIGN1cnJQYWdlID4gdG90YWxQYWdlcyAmJiB0b3RhbFBhZ2VzICE9PSAtMSApIHtcblx0XHRcdC8vIGVtaXQgZXZlbnQgZW5kIG9mIHBhZ2Vcblx0XHRcdEVWVC5FT1AuZW1pdCgpO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblxuXHRcdCRodHRwLmdldCggVE1EQl9BUEkudXJsICsgJ3NlYXJjaC9tb3ZpZScsIHtcblx0XHRcdGNhY2hlOiB0cnVlLFxuXHRcdFx0cGFyYW1zOiB7XG5cdFx0XHRcdGFwaV9rZXk6IFRNREJfQVBJLmtleSxcblx0XHRcdFx0cXVlcnk6IHNlYXJjaE9iai5xdWVyeSxcblx0XHRcdFx0cGFnZTogY3VyclBhZ2Vcblx0XHRcdH1cblx0XHR9IClcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHQvLyBlbWl0IGV2ZW50IHNlYXJjaCBzdWNjZXNzXG5cdFx0XHRzZWFyY2hSZXN1bHQgPSBzZWFyY2hSZXN1bHQuY29uY2F0KCByZW1vdmVOb1Bvc3Rlckl0ZW1zKCByZXMuZGF0YS5yZXN1bHRzICkgKTtcblx0XHRcdHRvdGFsUGFnZXMgPSByZXMuZGF0YS50b3RhbF9wYWdlcztcblx0XHRcdGN1cnJQYWdlICsrO1xuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ3NlYXJjaEJ5VGl0bGU6JywgcmVzLCByZXMuZGF0YSApO1xuXG5cdFx0XHQvLyBjYWNoZVxuXHRcdFx0cmVzLmRhdGEucmVzdWx0cy5mb3JFYWNoKCBmdW5jdGlvbiAoIGl0ZW0gKSB7XG5cblx0XHRcdFx0aWYgKCAhbW92aWVJZENhY2hlLmdldCggaXRlbS5pZCApICkge1xuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsIGl0ZW0uaWQsIGl0ZW0gKTtcblx0XHRcdFx0XHRtb3ZpZUlkQ2FjaGUucHV0KCBpdGVtLmlkLCBpdGVtICk7XG5cdFx0XHRcdH1cblxuXHRcdFx0fSApO1xuXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHQvLyBlbWl0IGV2ZW50IHNlYXJjaCBlcnJcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdzZWFyY2hCeVRpdGxlOicsIGVyciApO1xuXHRcdH0gKTtcblxuXHR9XG5cblx0ZnVuY3Rpb24gcmVtb3ZlTm9Qb3N0ZXJJdGVtcyggcmVzdWx0cyApIHtcblx0XHRyZXR1cm4gcmVzdWx0cy5maWx0ZXIoIGZ1bmN0aW9uICggaXRlbSApIHtcblx0XHRcdHJldHVybiAhIWl0ZW0ucG9zdGVyX3BhdGg7XG5cdFx0fSApO1xuXHR9XG5cblx0ZnVuY3Rpb24gZ2V0UmVzKCkge1xuXHRcdHJldHVybiBzZWFyY2hSZXN1bHQ7XG5cdH1cblxuXHRmdW5jdGlvbiBjbGVhclNlYXJjaCgpIHtcblx0XHQvLyBlbWl0IGV2ZW50IGNsZWFyU2VhY2hcblx0XHRzZWFyY2hSZXN1bHQubGVuZ3RoID0gMDtcblx0XHR0b3RhbFBhZ2VzID0gLTE7XG5cdFx0Y3VyclBhZ2UgPSAxO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRzZWFyY2hCeVRpdGxlLFxuXHRcdHNlYXJjaEJ5SWQsXG5cdFx0Y2xlYXJTZWFyY2gsXG5cdFx0Z2V0UmVzLFxuXHRcdHB1dEl0ZW1Ub0RCLFxuXHRcdG1vdmllSWRDYWNoZVxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdFTkRQT0lOVF9VUkknLCAnJGh0dHAnLCAnJHEnLCAnYXV0aFRva2VuJyxcbmZ1bmN0aW9uICggbG9nLCBFTkRQT0lOVF9VUkksICRodHRwLCAkcSwgYXV0aFRva2VuICkge1xuXG5cdFx0dmFyIGlkZW50aXR5ID0gbnVsbDtcblx0XHR2YXIgX2lkZW50aXR5UmVzb2x2ZWQgPSBmYWxzZTtcblxuXHRcdGZ1bmN0aW9uIGF1dGhvcml6ZSggZm9yY2UgKSB7XG5cblx0XHRcdHZhciBkZWZlcnJlZCA9ICRxLmRlZmVyKCk7XG5cblx0XHRcdGlmICggZm9yY2UgKSBpZGVudGl0eSA9IG51bGw7XG5cblx0XHRcdGlmICggaWRlbnRpdHkgIT09IG51bGwgKSB7XG5cblx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xuXG5cdFx0XHR9IGVsc2Uge1xuXG5cdFx0XHRcdCRodHRwLmdldCggRU5EUE9JTlRfVVJJICsgJ2F1dGgnLCB7IHJlcXVpcmVBdXRoOiB0cnVlIH0gKVxuXHRcdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdhdXRoLmF1dGhvcml6ZSgpOicsIHJlcywgcmVzLmRhdGEgKTtcblx0XHRcdFx0XHRcdGlkZW50aXR5ID0gcmVzLmRhdGE7XG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XG5cblx0XHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblxuXHRcdFx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2F1dGhvcml6ZScsIGVyciwgZXJyLmRhdGEgKTtcblx0XHRcdFx0XHRcdC8vIHRvZG8gaWYgand0IGV4cGlyZWQgLCBkZWF1dGhvcml6ZSwgcmVtb3ZlIGxvY2FsIHN0b3JhZ2UsIHJlZGlyZWN0XG5cdFx0XHRcdFx0XHRfaWRlbnRpdHlSZXNvbHZlZCA9IHRydWU7XG5cdFx0XHRcdFx0XHRkZWZlcnJlZC5yZWplY3QoIGVyciApO1xuXG5cdFx0XHRcdFx0fSApO1xuXG5cdFx0XHR9XG5cblx0XHRcdHJldHVybiBkZWZlcnJlZC5wcm9taXNlO1xuXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gZGVhdXRob3JpemUoKSB7XG5cdFx0XHRhdXRoVG9rZW4ucmVtb3ZlVG9rZW4oKTtcblx0XHRcdGlkZW50aXR5ID0gbnVsbDtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBpc0F1dGhlbnRpY2F0ZWQoKSB7XG5cdFx0XHRyZXR1cm4gaWRlbnRpdHkgIT09IG51bGw7XG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gaWRlbnRpdHlSZXNvbHZlZCgpIHtcblx0XHRcdHJldHVybiBfaWRlbnRpdHlSZXNvbHZlZDtcblx0XHR9XG5cblx0XHRyZXR1cm4ge1xuXG5cdFx0XHRhdXRob3JpemUsXG5cdFx0XHRkZWF1dGhvcml6ZSxcblx0XHRcdGlzQXV0aGVudGljYXRlZCxcblx0XHRcdGlkZW50aXR5UmVzb2x2ZWRcblxuXHRcdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnYXV0aFRva2VuJywgZnVuY3Rpb24gKCBhdXRoVG9rZW4gKSB7XG5cblx0ZnVuY3Rpb24gcmVxdWVzdCggY29uZmlnICkge1xuXG5cdFx0aWYgKCBjb25maWcucmVxdWlyZUF1dGggKSB7XG5cdFx0XHR2YXIgdG9rZW4gPSBhdXRoVG9rZW4uZ2V0VG9rZW4oKTtcblx0XHRcdGlmICggdG9rZW4gKSB7XG5cdFx0XHRcdC8vIGh0dHA6Ly9zZWxmLWlzc3VlZC5pbmZvL2RvY3MvZHJhZnQtaWV0Zi1vYXV0aC12Mi1iZWFyZXIuaHRtbCAgIHNlY3Rpb24gMi4xXG5cdFx0XHRcdC8vIGh0dHBzOi8vZGV2ZWxvcGVycy5nb29nbGUuY29tL2dtYWlsL21hcmt1cC9hY3Rpb25zL3ZlcmlmeWluZy1iZWFyZXItdG9rZW5zXG5cdFx0XHRcdC8vIGh0dHA6Ly93d3cudzMub3JnL1Byb3RvY29scy9yZmMyNjE2L3JmYzI2MTYtc2VjNC5odG1sIHNlY3Rpb24gNC4yIGhlYWRlciBmaWVsZCBuYW1lIGNhc2UgaW5zZW5zaXRpdmVcblx0XHRcdFx0Y29uZmlnLmhlYWRlcnMuQXV0aG9yaXphdGlvbiA9ICdCZWFyZXIgJyArIHRva2VuO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiBjb25maWc7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHJlc3BvbnNlKCByZXMgKSB7XG5cdFx0cmV0dXJuIHJlcztcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRyZXF1ZXN0LFxuXHRcdHJlc3BvbnNlXG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHdpbmRvdycsIGZ1bmN0aW9uICggbG9nLCAkd2luZG93ICkge1xuXG5cdHZhciBzdG9yYWdlID0gJHdpbmRvdy5sb2NhbFN0b3JhZ2U7XG5cdHZhciBjYWNoZWRUb2tlbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gc2V0VG9rZW4oIHRva2VuICkge1xuXHRcdGNhY2hlZFRva2VuID0gdG9rZW47XG5cdFx0c3RvcmFnZS5zZXRJdGVtKCAnand0JywgdG9rZW4gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIGdldFRva2VuKCkge1xuXHRcdGlmICggIWNhY2hlZFRva2VuICkge1xuXHRcdFx0Y2FjaGVkVG9rZW4gPSBzdG9yYWdlLmdldEl0ZW0oICdqd3QnICk7XG5cdFx0fVxuXHRcdHJldHVybiBjYWNoZWRUb2tlbjtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlbW92ZVRva2VuKCkge1xuXHRcdGNhY2hlZFRva2VuID0gbnVsbDtcblx0XHRzdG9yYWdlLnJlbW92ZUl0ZW0oICdqd3QnICk7XG5cdFx0bG9nLmRlYnVnKCAnYXV0aCcsICd0b2tlbiByZW1vdmVkJyApO1xuXHR9XG5cblx0ZnVuY3Rpb24gaGFzVG9rZW4oKSB7XG5cdFx0cmV0dXJuICEhZ2V0VG9rZW4oKTtcblx0fVxuXG5cdHJldHVybiB7XG5cblx0XHRzZXRUb2tlbixcblx0XHRnZXRUb2tlbixcblx0XHRyZW1vdmVUb2tlbixcblx0XHRoYXNUb2tlblxuXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICckaHR0cCcsICdFTkRQT0lOVF9VUkknLCAnYXV0aFRva2VuJywgJyRzdGF0ZScsXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCAkaHR0cCwgRU5EUE9JTlRfVVJJLCBhdXRoVG9rZW4sICRzdGF0ZSApICB7XG5cblx0dmFyIHZtID0gdGhpcztcblx0dm0udXNlciA9IHtcblx0XHRlbWFpbDogJycsXG5cdFx0cGFzc3dvcmQ6ICcnXG5cdH07XG5cblx0dm0uc2lnbmluID0gZnVuY3Rpb24oKSB7XG5cblx0XHRpZiAoIHZtLnVzZXIuZW1haWwgPT09ICcnIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09ICcnICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdlbWFpbCAmIHBhc3N3b3JkIHJlcXVpcmVkLicgKTtcblx0XHRcdHJldHVybjtcblx0XHR9XG5cblx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbmluJywgdm0udXNlciApXG5cdFx0XHQudGhlbiggZnVuY3Rpb24oIHJlcyApIHtcblx0XHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdzaWduaW4nLCByZXMsIHJlcy5kYXRhICk7XG5cdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcblx0XHRcdFx0JHN0YXRlLmdvKCAnY29sbGVjdGlvbicgKTtcblx0XHRcdH0sIGZ1bmN0aW9uKCBlcnIsIHN0YXR1cyApIHtcblx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NpZ25pbicsIGVyciApO1xuXHRcdFx0fSApO1xuXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCAkc3RhdGUsIGF1dGgsIG1vdmllQ29sbGVjdGlvbiApICB7XG5cblx0YXV0aC5kZWF1dGhvcml6ZSgpO1xuXHRtb3ZpZUNvbGxlY3Rpb24uX2NsZWFyKCk7XG5cdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsICRodHRwLCBFTkRQT0lOVF9VUkksIGF1dGhUb2tlbiwgJHN0YXRlICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS51c2VyID0ge307XG5cblx0XHR2bS5zaWdudXAgPSBmdW5jdGlvbiAoKSB7XG5cblx0XHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gdW5kZWZpbmVkIHx8IHZtLnVzZXIucGFzc3dvcmQgPT09IHVuZGVmaW5lZCApIHtcblx0XHRcdFx0bG9nLmRlYnVnKCAnd2FybicsICdlbWFpbCAmIHBhc3N3b3JkIHJlcXVpcmVkLicgKTtcblx0XHRcdFx0cmV0dXJuO1xuXHRcdFx0fVxuXG5cdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ3NpZ25pbmcgdXAuLi4nICk7XG5cdFx0XHQkaHR0cC5wb3N0KCBFTkRQT0lOVF9VUkkgKyAnc2lnbnVwJywgdm0udXNlciApXG5cdFx0XHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblxuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnUmVnaXN0ZXJlZC4nLCByZXMgKTtcblxuXHRcdFx0XHRcdGF1dGhUb2tlbi5zZXRUb2tlbiggcmVzLmRhdGEudG9rZW4gKTtcblx0XHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xuXG5cdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgZXJyICk7XG5cdFx0XHRcdFx0dm0uZm9ybS4kc3VibWl0dGVkID0gZmFsc2U7XG5cblx0XHRcdFx0fSApO1xuXG5cdFx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckcm9vdFNjb3BlJywgZnVuY3Rpb24gKCAkcm9vdFNjb3BlICkge1xuXG5cdHZhciBFVlQgPSB7XG5cblx0XHRFT1A6IHtcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdFT1AnLCBjYiApOyB9LFxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdFT1AnICk7IH1cblx0XHR9LFxuXHRcdGNvbGxlY3Rpb25Nb2RhbE9wZW46IHtcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdjb2xsZWN0aW9uTW9kYWxPcGVuJywgY2IgKTsgfSxcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnY29sbGVjdGlvbk1vZGFsT3BlbicgKTsgfVxuXHRcdH0sXG5cdFx0Y29sbGVjdGlvbk1vZGFsQ2xvc2U6IHtcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdjb2xsZWN0aW9uTW9kYWxDbG9zZScsIGNiICk7IH0sXG5cdFx0XHRlbWl0OiBmdW5jdGlvbiAoKSB7ICRyb290U2NvcGUuJGJyb2FkY2FzdCggJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJyApOyB9XG5cdFx0fSxcblx0XHRoZWxpeE5lZWRzUmVzZXQ6IHtcblx0XHRcdGxpc3RlbjogZnVuY3Rpb24gKCBjYiApIHsgJHJvb3RTY29wZS4kb24oICdoZWxpeE5lZWRzUmVzZXQnLCBjYiApOyB9LFxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdoZWxpeE5lZWRzUmVzZXQnICk7IH1cblx0XHR9XG5cblx0fTtcblxuXHRyZXR1cm4gRVZUO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xuXG5cdHZhciBkZWJ1Z0VuYWJsZWQgPSBmYWxzZTtcblx0dmFyIGRlYnVnTmFtZXNwYWNlcyA9IFtdO1xuXG5cdHRoaXMuZW5hYmxlRGVidWcgPSBmdW5jdGlvbiAoKSB7XG5cdFx0ZGVidWdFbmFibGVkID0gdHJ1ZTtcblx0fTtcblxuXHR0aGlzLmVuYWJsZURlYnVnTmFtZXNwYWNlID0gZnVuY3Rpb24gKCkge1xuXHRcdGZvciAoIGxldCBpID0gMDsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKyApIHtcblx0XHRcdGRlYnVnTmFtZXNwYWNlcy5wdXNoKCBhcmd1bWVudHNbIGkgXSApO1xuXHRcdH1cblx0fTtcblxuXHR0aGlzLiRnZXQgPSAoKSA9PiB7XG5cblx0XHRmdW5jdGlvbiBkZWJ1ZygpIHtcblx0XHRcdGlmICggIWRlYnVnRW5hYmxlZCApIHJldHVybjtcblx0XHRcdHZhciBkZWJ1Z05hbWUgPSBhcmd1bWVudHNbIDAgXTtcblx0XHRcdHZhciBzbGljZWRBcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoIGFyZ3VtZW50cywgMSApO1xuXHRcdFx0aWYgKCBkZWJ1Z05hbWUgPT09ICdlcnInICkge1xuXHRcdFx0XHRjb25zb2xlLmVycm9yLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWUgPT09ICdpbmZvJyApIHtcblx0XHRcdFx0Y29uc29sZS5pbmZvLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWUgPT09ICd3YXJuJyApIHtcblx0XHRcdFx0Y29uc29sZS53YXJuLmFwcGx5KCBjb25zb2xlLCBzbGljZWRBcmdzICk7XG5cdFx0XHR9IGVsc2UgaWYgKCBkZWJ1Z05hbWVzcGFjZXMuaW5kZXhPZiggZGVidWdOYW1lICkgIT09IC0xICkge1xuXHRcdFx0XHRjb25zb2xlLmxvZy5hcHBseSggY29uc29sZSwgWyBkZWJ1Z05hbWUgXS5jb25jYXQoIHNsaWNlZEFyZ3MgKSApO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdHJldHVybiB7XG5cdFx0XHRkZWJ1Z1xuXHRcdH07XG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcblxuXHRmdW5jdGlvbiBkZWJvdW5jZSggZnVuYywgd2FpdCwgaW1tZWRpYXRlICkge1xuXHRcdHZhciBfdGhpcyA9IHRoaXMsXG5cdFx0XHRfYXJndW1lbnRzID0gYXJndW1lbnRzO1xuXG5cdFx0dmFyIHRpbWVvdXQ7XG5cdFx0cmV0dXJuIGZ1bmN0aW9uICgpIHtcblxuXHRcdFx0dmFyIGNvbnRleHQgPSBfdGhpcyxcblx0XHRcdFx0YXJncyA9IF9hcmd1bWVudHM7XG5cdFx0XHR2YXIgbGF0ZXIgPSBmdW5jdGlvbiBsYXRlcigpIHtcblxuXHRcdFx0XHR0aW1lb3V0ID0gbnVsbDtcblx0XHRcdFx0aWYgKCAhaW1tZWRpYXRlICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xuXHRcdFx0fTtcblx0XHRcdHZhciBjYWxsTm93ID0gaW1tZWRpYXRlICYmICF0aW1lb3V0O1xuXHRcdFx0Y2xlYXJUaW1lb3V0KCB0aW1lb3V0ICk7XG5cdFx0XHR0aW1lb3V0ID0gc2V0VGltZW91dCggbGF0ZXIsIHdhaXQgKTtcblx0XHRcdGlmICggY2FsbE5vdyApIGZ1bmMuYXBwbHkoIGNvbnRleHQsIGFyZ3MgKTtcblx0XHR9O1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRkZWJvdW5jZVxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRodHRwUHJvdmlkZXInLCBmdW5jdGlvbiAoICRodHRwUHJvdmlkZXIgKSB7XG5cdCRodHRwUHJvdmlkZXIuaW50ZXJjZXB0b3JzLnB1c2goICdhdXRoSW50ZXJjZXB0b3InICk7XG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZ1Byb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLCBmdW5jdGlvbiAoIGxvZ1Byb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xuXG5cdGxvZ1Byb3ZpZGVyLmVuYWJsZURlYnVnKCk7XG5cdC8vIGxvZ1Byb3ZpZGVyLmVuYWJsZURlYnVnTmFtZXNwYWNlKCAnaW5mbycsICdlcnInLCAnYXV0aCcsICdhcGknLCAnY29sbGVjdGlvbicgKTtcblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWdOYW1lc3BhY2UoICdpbmZvJywgJ2VycicgKTtcblxuXHQkaHR0cFByb3ZpZGVyLnVzZUxlZ2FjeVByb21pc2VFeHRlbnNpb25zKCBmYWxzZSApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZVByb3ZpZGVyJywgJyR1cmxSb3V0ZXJQcm92aWRlcicsICckaHR0cFByb3ZpZGVyJyxcbmZ1bmN0aW9uICggJHN0YXRlUHJvdmlkZXIsICR1cmxSb3V0ZXJQcm92aWRlciwgJGh0dHBQcm92aWRlciApIHtcblxuXHQkdXJsUm91dGVyUHJvdmlkZXIub3RoZXJ3aXNlKCAnLycgKTtcblxuXHQkc3RhdGVQcm92aWRlclxuXHRcdC5zdGF0ZSggJ2hlbGl4Jywge1xuXHRcdFx0dXJsOiAnLycsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvaGVsaXguaHRtbCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWdudXAnLCB7XG5cdFx0XHR1cmw6ICcvc2lnbnVwJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9zaWdudXAuaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbnVwQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdzaWdudXAnXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbmluJywge1xuXHRcdFx0dXJsOiAnL3NpZ25pbicsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvc2lnbmluLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ3NpZ25pbkN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnc2lnbmluJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ25vdXQnLCB7XG5cdFx0XHR1cmw6ICcvc2lnbm91dCcsXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbm91dEN0cmwnXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnbW92aWVEZXRhaWwnLCB7XG5cdFx0XHR1cmw6ICcvbW92aWUvOm1vdmllSWQnLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL21vdmllRGV0YWlsLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ21vdmllRGV0YWlsQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdtZCcsXG5cdFx0XHRyZXNvbHZlOiB7XG5cdFx0XHRcdG1vdmllSXRlbTogWyAnJHN0YXRlUGFyYW1zJywgJ1RNRGInLCBmdW5jdGlvbiAoICRzdGF0ZVBhcmFtcywgVE1EYiApIHtcblx0XHRcdFx0XHRyZXR1cm4gVE1EYi5zZWFyY2hCeUlkKCAkc3RhdGVQYXJhbXMubW92aWVJZCApO1xuXHRcdFx0XHR9IF1cblx0XHRcdH1cblx0XHR9IClcblx0XHQuc3RhdGUoJ2NvbGxlY3Rpb24nLCB7XG5cdFx0XHR1cmw6ICcvY29sbGVjdGlvbicsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvY29sbGVjdGlvbi5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdtb3ZpZUNvbGxlY3Rpb25DdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ21jJyxcblx0XHRcdHJlc29sdmU6IHtcblx0XHRcdFx0YXV0aG9yaXplOiBbICdhdXRoJywgZnVuY3Rpb24gKCBhdXRoICkge1xuXHRcdFx0XHRcdHJldHVybiBhdXRoLmF1dGhvcml6ZSgpO1xuXHRcdFx0XHR9IF0sXG5cdFx0XHRcdHJlc29sdmVkQ29sbGVjdGlvbjogWyAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCBtb3ZpZUNvbGxlY3Rpb24gKSB7XG5cdFx0XHRcdFx0cmV0dXJuIG1vdmllQ29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpO1xuXHRcdFx0XHR9IF1cblx0XHRcdH1cblx0XHR9KVxuXHQ7XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyBmdW5jdGlvbiAoKSB7XG5cblx0ZnVuY3Rpb24gbGluayggJHNjb3BlLCAkZWxlbWVudCwgJGF0dHJzICkge1xuXG5cdFx0JGVsZW1lbnRcblx0XHQub24oICdtb3VzZWVudGVyJywgZnVuY3Rpb24gKCkge1xuXHRcdFx0JGVsZW1lbnQucmVtb3ZlQ2xhc3MoICRhdHRycy5sZWF2ZSApO1xuXHRcdFx0JGVsZW1lbnQuYWRkQ2xhc3MoICRhdHRycy5ob3ZlciApO1xuXHRcdH0gKVxuXHRcdC5vbiggJ21vdXNlbGVhdmUnLCBmdW5jdGlvbiAoKSB7XG5cdFx0XHQkZWxlbWVudC5yZW1vdmVDbGFzcyggJGF0dHJzLmhvdmVyICk7XG5cdFx0XHQkZWxlbWVudC5hZGRDbGFzcyggJGF0dHJzLmxlYXZlICk7XG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnQScsXG5cdFx0bGluazogbGlua1xuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCAnRU5HSU5FJywgJ3V0aWwnLCBmdW5jdGlvbiAoICR3aW5kb3csIEVOR0lORSwgdXRpbCApIHtcblxuXHRmdW5jdGlvbiBjdHJsKCAkc2NvcGUsICRlbGVtZW50ICkge1xuXG5cdFx0RU5HSU5FLmF0dGFjaFJlbmRlcmVyKCAkZWxlbWVudCApO1xuXHRcdCQoICR3aW5kb3cgKS5vbiggJ3Jlc2l6ZScsIHV0aWwuZGVib3VuY2UoIEVOR0lORS5vbldpbmRvd1Jlc2l6ZSwgMTAwICkgKTtcblx0XHQkZWxlbWVudC5vbiggJ3doZWVsJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHRFTkdJTkUuJCQud2hlZWxfZHkgPSAtTWF0aC5zaWduKCBldnQub3JpZ2luYWxFdmVudC5kZWx0YVkgKTtcblx0XHR9ICk7XG5cblx0XHRFTkdJTkUuc3RhcnQoKTtcblxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZXN0cmljdDogJ0UnLFxuXHRcdHJlcGxhY2U6IHRydWUsXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHR0ZW1wbGF0ZTogJzxkaXYgaWQ9XCJjYW52YXMtY29udGFpbmVyXCI+PC9kaXY+J1xuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyR3aW5kb3cnLCBmdW5jdGlvbiAoICR3aW5kb3cgKSB7XG5cblx0dmFyICQkID0ge1xuXHRcdGNhbnZhczogbnVsbCxcblx0XHRzdGF0czogbmV3IFN0YXRzKCksXG5cdFx0c2NlbmU6IG5ldyBUSFJFRS5TY2VuZSgpLFxuXHRcdHdpZHRoOiAkKHdpbmRvdykud2lkdGgoKSxcblx0XHRoZWlnaHQ6ICQod2luZG93KS5oZWlnaHQoKSxcblx0XHRjYW1lcmE6IG5ldyBUSFJFRS5QZXJzcGVjdGl2ZUNhbWVyYSggNzAsIHRoaXMud2lkdGggLyB0aGlzLmhlaWdodCwgMTAsIDEwMDAwMCApLFxuXHRcdHJlbmRlcmVyOiBuZXcgVEhSRUUuQ1NTM0RSZW5kZXJlcigpLFxuXHRcdHNjcmVlbl9yYXRpbzogdGhpcy53aWR0aCAvIHRoaXMuaGVpZ2h0LFxuXHRcdHBpeGVsX3JhdGlvOiAkd2luZG93LmRldmljZVBpeGVsUmF0aW8gfHwgMSxcblx0XHRtb3VzZV94OiB0aGlzLndpZHRoICogMC41LFxuXHRcdG1vdXNlX3k6IHRoaXMuaGVpZ2h0ICogMC41LFxuXHRcdHdoZWVsX2R5OiAwXG5cdH07XG5cblx0JCQucmVuZGVyZXIuc2V0U2l6ZSggJCQud2lkdGgsICQkLmhlaWdodCApO1xuXG5cdGZ1bmN0aW9uIGF0dGFjaFJlbmRlcmVyKCBjYW52YXMgKSB7XG5cdFx0JCQuY2FudmFzID0gY2FudmFzO1xuXHRcdGNhbnZhcy5hcHBlbmQoICQkLnJlbmRlcmVyLmRvbUVsZW1lbnQgKTtcblx0XHRjYW52YXMuYXBwZW5kKCAkJC5zdGF0cy5kb21FbGVtZW50ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBvbldpbmRvd1Jlc2l6ZSgpIHtcblx0XHQkJC53aWR0aCA9ICQod2luZG93KS53aWR0aCgpO1xuXHRcdCQkLmhlaWdodCA9ICQod2luZG93KS5oZWlnaHQoKTtcblx0XHQkJC5waXhlbF9yYXRpbyA9ICR3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxO1xuXHRcdCQkLnNjcmVlbl9yYXRpbyA9ICQkLndpZHRoIC8gJCQuaGVpZ2h0O1xuXHRcdCQkLmNhbWVyYS5hc3BlY3QgPSAkJC5zY3JlZW5fcmF0aW87XG5cdFx0JCQuY2FtZXJhLnVwZGF0ZVByb2plY3Rpb25NYXRyaXgoKTtcblx0XHQkJC5yZW5kZXJlci5zZXRTaXplKCAkJC53aWR0aCwgJCQuaGVpZ2h0ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBzZXR1cCgpIHtcblxuXHR9XG5cblx0ZnVuY3Rpb24gdXBkYXRlKCkge1xuXG5cdFx0aWYgKCBNYXRoLmFicyggJCQud2hlZWxfZHkgKSA+IDAuMDAxICkge1xuXHRcdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnkgKz0gJCQud2hlZWxfZHkgKiAxLjA7XG5cdFx0XHQkJC5jYW1lcmEucm90YXRlWSggJCQud2hlZWxfZHkgKiAwLjAyNSApO1xuXHRcdFx0JCQud2hlZWxfZHkgKj0gMC45NTtcblx0XHR9XG5cblx0fVxuXG5cdC8vIC0tLS0gIGRyYXcgbG9vcFxuXHRmdW5jdGlvbiBydW4oKSB7XG5cblx0XHRyZXF1ZXN0QW5pbWF0aW9uRnJhbWUoIHJ1biApO1xuXHRcdHVwZGF0ZSgpO1xuXHRcdCQkLnJlbmRlcmVyLnJlbmRlciggJCQuc2NlbmUsICQkLmNhbWVyYSApO1xuXHRcdCQkLnN0YXRzLnVwZGF0ZSgpO1xuXG5cdH1cblxuXHRmdW5jdGlvbiBzdGFydCgpIHtcblx0XHRzZXR1cCgpO1xuXHRcdHJ1bigpO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVzZXRDYW1lcmEoKSB7XG5cdFx0JCQuY2FtZXJhLnBvc2l0aW9uLnNldCggMCwgMCwgMCApO1xuXHRcdCQkLmNhbWVyYS5yb3RhdGlvbi5zZXQoIDAsIDAsIDAgKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0JCQsXG5cdFx0YXR0YWNoUmVuZGVyZXIsXG5cdFx0b25XaW5kb3dSZXNpemUsXG5cdFx0c3RhcnQsXG5cdFx0cmVzZXRDYW1lcmEsXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VOR0lORScsICckY29tcGlsZScsICckcm9vdFNjb3BlJyxcbmZ1bmN0aW9uICggbG9nLCBFTkdJTkUsICRjb21waWxlLCAkcm9vdFNjb3BlICkge1xuXG5cdHZhciBhbGxQb3N0ZXJzID0gbmV3IFRIUkVFLk9iamVjdDNEKCk7XG5cdEVOR0lORS4kJC5zY2VuZS5hZGQoIGFsbFBvc3RlcnMgKTtcblxuXHRmdW5jdGlvbiBtYWtlSGVsaXhQb3N0ZXJzKCBwb3N0ZXJPYmplY3RNdWx0aSwgb2Zmc2V0U3RhcnRJZHggKSB7XG5cblx0XHR2YXIgdmVjdG9yID0gbmV3IFRIUkVFLlZlY3RvcjMoKTtcblx0XHR2YXIgcmFkaXVzID0gOTAwO1xuXHRcdGZvciAoIHZhciBpID0gMDsgaSA8IHBvc3Rlck9iamVjdE11bHRpLmxlbmd0aDsgaSsrICkge1xuXG5cdFx0XHR2YXIgJGlzb2xhdGVkU2NvcGUgPSAkcm9vdFNjb3BlLiRuZXcoIHRydWUgKTtcblx0XHRcdCRpc29sYXRlZFNjb3BlLm1vdmllSXRlbSA9IHBvc3Rlck9iamVjdE11bHRpWyBpIF07XG5cblx0XHRcdHZhciBwb3N0ZXJEaXJlY3RpdmVFbGVtID0gJGNvbXBpbGUoICc8cG9zdGVyPjwvcG9zdGVyPicgKSggJGlzb2xhdGVkU2NvcGUgKVsgMCBdO1xuXHRcdFx0dmFyIGNzczNkT2JqID0gbmV3IFRIUkVFLkNTUzNET2JqZWN0KCBwb3N0ZXJEaXJlY3RpdmVFbGVtICk7XG5cblx0XHRcdC8vIHRhZyBhbG9nIGFuIGlzb2xhdGVkU2NvcGUgdG8gYmUgZGVzdHJveSB3aGVuIGRpc3Bvc2UgYW4gZWxlbWVudFxuXHRcdFx0Y3NzM2RPYmouc2NvcGUgPSAkaXNvbGF0ZWRTY29wZTtcblxuXHRcdFx0dmFyIGhpZHggPSBpICsgb2Zmc2V0U3RhcnRJZHg7XG5cdFx0XHR2YXIgcGhpID0gaGlkeCAqIDAuMTc1ICsgTWF0aC5QSTtcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnggPSAtIHJhZGl1cyAqIE1hdGguc2luKCBwaGkgKTtcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnkgPSAtICggaGlkeCAqIDggKSArIDIwMDtcblx0XHRcdGNzczNkT2JqLnBvc2l0aW9uLnogPSByYWRpdXMgKiBNYXRoLmNvcyggcGhpICk7XG5cblx0XHRcdHZlY3Rvci5zZXQoIC1jc3MzZE9iai5wb3NpdGlvbi54ICogMiwgY3NzM2RPYmoucG9zaXRpb24ueSwgLWNzczNkT2JqLnBvc2l0aW9uLnogKiAyICk7XG5cblx0XHRcdGNzczNkT2JqLmxvb2tBdCggdmVjdG9yICk7XG5cdFx0XHRhbGxQb3N0ZXJzLmFkZCggY3NzM2RPYmogKTtcblxuXHRcdH1cblxuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAnY3VyciBwb3N0ZXJzOicsIGFsbFBvc3RlcnMuY2hpbGRyZW4ubGVuZ3RoICk7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIGNsZWFyQWxsKCkge1xuXHRcdGFsbFBvc3RlcnMuY2hpbGRyZW4uZm9yRWFjaCggZnVuY3Rpb24gKCBwb3N0ZXIgKSB7XG5cdFx0XHRwb3N0ZXIuZGlzcG9zZUVsZW1lbnQoKTtcblx0XHRcdHBvc3Rlci5zY29wZS4kZGVzdHJveSgpO1xuXHRcdH0gKTtcblx0XHRhbGxQb3N0ZXJzLmNoaWxkcmVuLmxlbmd0aCA9IDA7IC8vIGNsZWFyIGl0ZW1zXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdG1ha2VIZWxpeFBvc3RlcnMsXG5cdFx0Y2xlYXJBbGxcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsIGZ1bmN0aW9uICggJHN0YXRlLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlICkge1xuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQgKSB7XG5cblx0XHQvLyAkc2NvcGUubW92aWVJdGVtIG9iaiBpcyBwYXNzZWQgdGhydSBpc29sYXRlZFNjb3BlIHZpYSBjb21waWxlZCBkaXJlY3RpdmUgaW4gaGVsaXguZmFjLmpzXG5cdFx0dmFyIGltZyA9IG5ldyBJbWFnZSgpO1xuXHRcdHZhciBpbWdVcmwgPSAnaHR0cDovL2ltYWdlLnRtZGIub3JnL3QvcC93MTU0LycgKyAkc2NvcGUubW92aWVJdGVtLnBvc3Rlcl9wYXRoO1xuXHRcdGltZy5vbmxvYWQgPSBmdW5jdGlvbiAoKSB7XG5cblx0XHRcdC8vIHRvZG8gbW92ZSBjc3MgaW50byBzYXNzLCB1c2UgY2xhc3MgaW5zdGVhZFxuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XG5cdFx0XHRcdCd3aWR0aCc6ICcxNTBweCcsXG5cdFx0XHRcdCdoZWlnaHQnOiAnMjMwcHgnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1yZXBlYXQnOiAnbm8tcmVwZWF0Jyxcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICcxNTBweCAyMzBweCcsXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLWltYWdlJzogJ3VybCgnICsgaW1nVXJsICsgJyknLFxuXHRcdFx0XHQnZGlzcGxheSc6ICdub25lJyAvLyByZXF1aXJlZCBmb3IgZmFkZUluIGFuaW1hdGlvblxuXHRcdFx0fSApO1xuXHRcdFx0JGVsZW1lbnQuZmFkZUluKCAxNTAwICk7XG5cblx0XHR9O1xuXHRcdGltZy5zcmMgPSBpbWdVcmw7XG5cblx0XHQkZWxlbWVudC5vbiggJ2NsaWNrJywgZnVuY3Rpb24gKCBldnQgKSB7XG5cdFx0XHQkc3RhdGUuZ28oICdtb3ZpZURldGFpbCcsIHsgbW92aWVJZDogJHNjb3BlLm1vdmllSXRlbS5pZCB9ICk7XG5cdFx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLnNldEFjdGl2ZUl0ZW0oICRzY29wZS5tb3ZpZUl0ZW0gKTtcblx0XHR9ICk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRyZXBsYWNlOiB0cnVlLFxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXG5cdFx0dGVtcGxhdGU6ICc8ZGl2IGNsYXNzPVwicG9zdGVyRWxlbVwiPjwvZGl2Pidcblx0fTtcblxufSBdO1xuIiwiYW5ndWxhci5tb2R1bGUoICdhcHAnLCBbXG5cdCd1aS5yb3V0ZXInLFxuXHQnbmdBbmltYXRlJ1xuXSApXG4uY29uc3RhbnQoICdFTkRQT0lOVF9VUkknLCAnaHR0cDovL2xvY2FsaG9zdDo4MDAxLycgKVxuLmNvbnN0YW50KCAnVE1EQl9BUEknLCB7XG5cdGtleTogJzM3NGMwMzQyYTY0MDZkZmUwYWViM2RlMmVhMDQyYzU5Jyxcblx0dXJsOiAnaHR0cDovL2FwaS50aGVtb3ZpZWRiLm9yZy8zLydcbn0gKVxuXG4ucHJvdmlkZXIoICdsb2cnLCByZXF1aXJlKCAnLi9jb21tb24vbG9nLnB2LmpzJyApIClcbi5mYWN0b3J5KCAndXRpbCcsIHJlcXVpcmUoICcuL2NvbW1vbi91dGlsLmpzJyApIClcbi5mYWN0b3J5KCAnRVZUJywgcmVxdWlyZSggJy4vY29tbW9uL2V2ZW50cy5mYWMuanMnICkgKVxuXG4uZmFjdG9yeSggJ1RNRGInLCByZXF1aXJlKCAnLi9BUEkvVE1EYi5mYWMuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21haW5DdHJsJywgcmVxdWlyZSggJy4vbWFpbi5jdHJsLmpzJyApIClcbi5mYWN0b3J5KCAnRU5HSU5FJywgcmVxdWlyZSggJy4vaGVsaXgvZW5naW5lLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2hlbGl4JywgcmVxdWlyZSggJy4vaGVsaXgvaGVsaXguZmFjLmpzJyApIClcbi5kaXJlY3RpdmUoICdkaXNwbGF5JywgcmVxdWlyZSggJy4vaGVsaXgvZGlzcGxheS5kaXIuanMnICkgKVxuLmRpcmVjdGl2ZSggJ3Bvc3RlcicsIHJlcXVpcmUoICcuL2hlbGl4L3Bvc3Rlci5kaXIuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21vdmllRGV0YWlsQ3RybCcsIHJlcXVpcmUoICcuL21vdmllRGV0YWlsLmN0cmwuanMnICkgKVxuXG4uZmFjdG9yeSggJ2F1dGgnLCByZXF1aXJlKCAnLi9hdXRoL2F1dGguZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aFRva2VuJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoVG9rZW4uZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnYXV0aEludGVyY2VwdG9yJywgcmVxdWlyZSggJy4vYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbnVwQ3RybCcsIHJlcXVpcmUoICcuL2F1dGgvc2lnbnVwLmN0cmwuanMnICkgKVxuLmNvbnRyb2xsZXIoICdzaWduaW5DdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWduaW4uY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25vdXRDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdub3V0LmN0cmwuanMnICkgKVxuXG4uY29udHJvbGxlciggJ21vdmllQ29sbGVjdGlvbkN0cmwnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmN0cmwuanMnICkgKVxuLmZhY3RvcnkoICdtb3ZpZUNvbGxlY3Rpb24nLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vbW92aWVDb2xsZWN0aW9uLmZhYy5qcycgKSApXG4uZmFjdG9yeSggJ2NvbGxlY3Rpb25Nb2RhbFNlcnZpY2UnLCByZXF1aXJlKCAnLi9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsU2VydmljZS5mYWMuanMnICkgKVxuLmRpcmVjdGl2ZSggJ2NvbGxlY3Rpb25Nb2RhbCcsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWwuZGlyLmpzJyApIClcbi5kaXJlY3RpdmUoICdjb2xsZWN0aW9uSXRlbScsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uSXRlbS5kaXIuanMnICkgKVxuXG4uZGlyZWN0aXZlKCAnaG92ZXJDbGFzcycsIHJlcXVpcmUoICcuL2RpcmVjdGl2ZS9ob3ZlckNsYXNzLmRpci5qcycgKSApXG5cbi5jb25maWcoIHJlcXVpcmUoICcuL2NvbmZpZy9yb3V0ZUNvbmZpZy5qcycgKSApXG4uY29uZmlnKCByZXF1aXJlKCAnLi9jb25maWcvbG9nQ29uZmlnLmpzJyApIClcbi5jb25maWcoIHJlcXVpcmUoICcuL2NvbmZpZy9odHRwQ29uZmlnLmpzJyApIClcbi5ydW4oIFsgJ2xvZycsICckcm9vdFNjb3BlJywgJyRzdGF0ZScsICdhdXRoJywgJ21vdmllQ29sbGVjdGlvbicsIGZ1bmN0aW9uICggbG9nLCAkcm9vdFNjb3BlLCAkc3RhdGUsIGF1dGgsIG1vdmllQ29sbGVjdGlvbiApIHtcblxuXHRhdXRoLmF1dGhvcml6ZSggdHJ1ZSApO1xuXG5cdG1vdmllQ29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpO1xuXG5cdCRyb290U2NvcGUuJG9uKCAnJHN0YXRlQ2hhbmdlRXJyb3InLCBmdW5jdGlvbiAoIGV2ZW50LCB0b1N0YXRlLCB0b1BhcmFtcywgZnJvbVN0YXRlLCBmcm9tUGFyYW1zLCBlcnJvciApIHtcblxuXHRcdGV2ZW50LnByZXZlbnREZWZhdWx0KCk7IC8vIHByZXZlbnQgdHJhbnNpdGlvblxuXHRcdGxvZy5kZWJ1ZyggJ3dhcm4nLCBlcnJvciApO1xuXHRcdGlmICggZXJyb3IgKSB7XG5cdFx0XHQkc3RhdGUuZ28oICdzaWduaW4nICk7XG5cdFx0fVxuXG5cdH0gKTtcblxufSBdIClcbjtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJyRzY29wZScsICdUTURiJywgJ0VWVCcsICdoZWxpeCcsICdFTkdJTkUnLCAnYXV0aCcsICckc3RhdGUnLCAnJHJvb3RTY29wZScsXG5mdW5jdGlvbiAoIGxvZywgJHNjb3BlLCBUTURiLCBFVlQsIGhlbGl4LCBFTkdJTkUsIGF1dGgsICRzdGF0ZSwgJHJvb3RTY29wZSApIHtcblxuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS5hdXRoID0gYXV0aDtcblx0dm0uc2VhcmNoID0ge1xuXHRcdHF1ZXJ5OiAnJyxcblx0fTtcblx0dm0ubW92aWVJdGVtcyA9IG51bGw7XG5cblx0JHNjb3BlLiR3YXRjaCggVE1EYi5nZXRSZXMsIGZ1bmN0aW9uICggbW92SXRlbXMsIG9sZE1vdkl0ZW1zICkge1xuXG5cdFx0dm0ubW92aWVJdGVtcyA9IG1vdkl0ZW1zO1xuXHRcdGhlbGl4Lm1ha2VIZWxpeFBvc3RlcnMoIG1vdkl0ZW1zLnNsaWNlKCBvbGRNb3ZJdGVtcy5sZW5ndGggKSwgb2xkTW92SXRlbXMubGVuZ3RoICk7XG5cblx0fSwgdHJ1ZSApO1xuXG5cdHZhciBwcmV2UXVlcnkgPSAnJztcblx0dmFyIGhlbGl4TmVlZHNSZXNldCA9IGZhbHNlO1xuXHRFVlQuaGVsaXhOZWVkc1Jlc2V0Lmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdGhlbGl4TmVlZHNSZXNldCA9IHRydWU7XG5cdH0gKTtcblxuXHR2bS5zZWFyY2ggPSBmdW5jdGlvbiAoKSB7XG5cdFx0aWYgKCB2bS5zZWFyY2gucXVlcnkgPT09ICcnICkgcmV0dXJuO1xuXHRcdGlmICggcHJldlF1ZXJ5ICE9PSB2bS5zZWFyY2gucXVlcnkgfHwgaGVsaXhOZWVkc1Jlc2V0ICkge1xuXHRcdFx0cHJldlF1ZXJ5ID0gdm0uc2VhcmNoLnF1ZXJ5O1xuXHRcdFx0VE1EYi5jbGVhclNlYXJjaCgpO1xuXHRcdFx0aGVsaXguY2xlYXJBbGwoKTtcblx0XHRcdEVOR0lORS5yZXNldENhbWVyYSgpO1xuXHRcdFx0aGVsaXhOZWVkc1Jlc2V0ID0gZmFsc2U7XG5cdFx0fVxuXHRcdGlmICggJHN0YXRlLmN1cnJlbnQubmFtZSAhPT0gJ2hlbGl4JyApIHtcblx0XHRcdCRzdGF0ZS5nbyggJ2hlbGl4JyApO1xuXHRcdH1cblx0XHRUTURiLnNlYXJjaEJ5VGl0bGUoIHZtLnNlYXJjaCApO1xuXHR9O1xuXG5cdC8vIERFQlVHXG5cdHdpbmRvdy5TQ09QRSA9ICRzY29wZTtcblx0dm0uVE1EYiA9IFRNRGI7XG5cdHZtLmhlbGl4ID0gaGVsaXg7XG5cdHZtLkVOR0lORSA9IEVOR0lORTtcblx0dm0uU1RBVEUgPSAkc3RhdGU7XG5cblx0RVZULkVPUC5saXN0ZW4oIGZ1bmN0aW9uICgpIHtcblx0XHRsb2cuZGVidWcoICdpbmZvJywgJ3JlY2lldmVkIEVPUCBldmVudCEnICk7XG5cdH0gKTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnVE1EYicsIGZ1bmN0aW9uICggbG9nLCBUTURiICkge1xuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGF0dHJzLCAkZWxlbWVudCApIHtcblxuXHRcdFRNRGIuc2VhcmNoQnlJZCggcGFyc2VJbnQoICRzY29wZS5tb3ZpZUlkICkgKVxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblxuXHRcdFx0Ly8gbG9nLmRlYnVnKCAnaW5mbycsICdjb2xsZWN0aW9uSXRlbURpcmVjdGl2ZScsIHJlcyApO1xuXHRcdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL3c5Mi8nICsgcmVzLnBvc3Rlcl9wYXRoO1xuXHRcdFx0JGVsZW1lbnQuY3NzKCB7XG5cdFx0XHRcdCd3aWR0aCc6ICcxMDAlJyxcblx0XHRcdFx0J2hlaWdodCc6ICcxMDAlJyxcblx0XHRcdFx0J2JhY2tncm91bmQtcmVwZWF0JzogJ25vLXJlcGVhdCcsXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXNpemUnOiAnMTAwJSAxMDAlJyxcblx0XHRcdFx0J2JhY2tncm91bmQtaW1hZ2UnOiAndXJsKCcgKyBpbWdVcmwgKyAnKSdcblx0XHRcdH0gKTtcblxuXHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ2NvbGxlY3Rpb25JdGVtRGlyZWN0aXZlJywgZXJyICk7XG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRzY29wZTogeyBtb3ZpZUlkOiAnQCcgfSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdGNvbnRyb2xsZXJBczogJ2NpJyxcblx0XHR0ZW1wbGF0ZTogJzxkaXY+PC9kaXY+J1xuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdtb3ZpZUNvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsICdFVlQnLFxuZnVuY3Rpb24gKCBsb2csIG1vdmllQ29sbGVjdGlvbiwgY29sbGVjdGlvbk1vZGFsU2VydmljZSwgRVZUICkge1xuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQsICRhdHRycyApIHtcblxuXHRcdHZhciB2bSA9IHRoaXM7XG5cdFx0dm0ubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xuXHRcdHZtLmNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UgPSBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlO1xuXG5cdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xuXG5cdFx0dm0ub3BlbkVkaXRvciA9IGZ1bmN0aW9uICgpIHtcblx0XHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSB0cnVlO1xuXHRcdH07XG5cblx0XHR2bS5jbG9zZUVkaXRvciA9IGZ1bmN0aW9uICgpIHtcblx0XHRcdHZtLmFkZGluZ05ld0NvbGxlY3Rpb24gPSBmYWxzZTtcblx0XHR9O1xuXG5cdFx0dm0uY3JlYXRlTmV3Q29sbGVjdGlvbiA9IGZ1bmN0aW9uICgpIHtcblx0XHRcdG1vdmllQ29sbGVjdGlvbi5jcmVhdGUoICRzY29wZS5uZXdDb2xsZWN0aW9uTmFtZSApO1xuXHRcdFx0JHNjb3BlLm5ld0NvbGxlY3Rpb25OYW1lID0gJyc7XG5cdFx0XHR2bS5jbG9zZUVkaXRvcigpO1xuXHRcdH07XG5cblx0XHR2bS5hZGRUb0NvbGxlY3Rpb24gPSBmdW5jdGlvbiAoIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdhZGRUb0NvbGxlY3Rpb246JywgbW92aWVJZCwgY29sbGVjdGlvbk5hbWUgKTtcblx0XHRcdHZhciBzdWNjZXNzID0gbW92aWVDb2xsZWN0aW9uLnB1c2goIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICk7XG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ21vdmllQ29sbGVjdGlvbi5wdXNoJywgc3VjY2VzcyApO1xuXHRcdH07XG5cblx0XHR2bS5jbG9zZU1vZGFsID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xuXHRcdFx0JHNjb3BlLm5ld0NvbGxlY3Rpb25OYW1lID0gJyc7XG5cdFx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLmNsb3NlKCk7XG5cdFx0fTtcblxuXHRcdC8vIGRlZmF1bHQgY3NzIGF0IGRpcmVjdGl2ZSBpbml0aWFsaXphdGlvblxuXHRcdCRlbGVtZW50LmNzcyggeyB2aXNpYmlsaXR5OiAnaGlkZGVuJyB9ICk7XG5cblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsT3Blbi5saXN0ZW4oIGZ1bmN0aW9uICgpIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsT3BlbicgKTtcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ3Zpc2libGUnIH0gKTtcblx0XHR9ICk7XG5cblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UubGlzdGVuKCBmdW5jdGlvbiAoKSB7XG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJyApO1xuXHRcdCRlbGVtZW50LmNzcyggeyB2aXNpYmlsaXR5OiAnaGlkZGVuJyB9ICk7XG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRzY29wZToge30sXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHRjb250cm9sbGVyQXM6ICdtb2RhbCcsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvY29sbGVjdGlvbk1vZGFsLmh0bWwnXG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRVZUJywgJ2F1dGgnLCAnJHN0YXRlJywgZnVuY3Rpb24gKCBsb2csIEVWVCwgYXV0aCwgJHN0YXRlICkge1xuXG5cdHZhciBhY3RpdmVJdGVtID0gbnVsbDtcblxuXHRmdW5jdGlvbiBzZXRBY3RpdmVJdGVtKCBpdGVtICkge1xuXHRcdGFjdGl2ZUl0ZW0gPSBpdGVtO1xuXHR9XG5cblx0ZnVuY3Rpb24gZ2V0QWN0aXZlSXRlbSggaXRlbSApIHtcblx0XHRyZXR1cm4gYWN0aXZlSXRlbTtcblx0fVxuXG5cdGZ1bmN0aW9uIG9wZW4oKSB7XG5cdFx0aWYgKCBhdXRoLmlzQXV0aGVudGljYXRlZCgpICkge1xuXHRcdFx0RVZULmNvbGxlY3Rpb25Nb2RhbE9wZW4uZW1pdCgpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHQkc3RhdGUuZ28oICdzaWduaW4nICk7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gY2xvc2UoKSB7XG5cdFx0RVZULmNvbGxlY3Rpb25Nb2RhbENsb3NlLmVtaXQoKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0c2V0QWN0aXZlSXRlbSxcblx0XHRnZXRBY3RpdmVJdGVtLFxuXHRcdG9wZW4sXG5cdFx0Y2xvc2Vcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgJ1RNRGInLCAnaGVsaXgnLCAnRU5HSU5FJywgJyRzdGF0ZScsICdFVlQnLFxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uLCBUTURiLCBoZWxpeCwgRU5HSU5FLCAkc3RhdGUsIEVWVCApICB7XG5cblx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uQ3RybCcsIG1vdmllQ29sbGVjdGlvbi5nZXRDb2xsZWN0aW9uKCkgKTtcblx0dmFyIHZtID0gdGhpcztcblx0dm0ubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xuXG5cdHZtLnZpZXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCBjb2xsZWN0aW9uICkge1xuXG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICd2aWV3Q29sbGVjdGlvbiA9PicsIGNvbGxlY3Rpb24gKTtcblxuXHRcdHZhciBsb2FkZWRJdGVtcyA9IDA7XG5cdFx0dmFyIHRvdGFsSXRlbXMgPSBjb2xsZWN0aW9uLm1vdmllcy5sZW5ndGg7XG5cdFx0dmFyIGFsbE1vdmllcyA9IFtdO1xuXG5cdFx0Y29sbGVjdGlvbi5tb3ZpZXMuZm9yRWFjaCggZnVuY3Rpb24gKCBtb3ZpZUlkICkge1xuXG5cdFx0XHRUTURiLnNlYXJjaEJ5SWQoIG1vdmllSWQgKVxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRcdFx0YWxsTW92aWVzLnB1c2goIHJlcyApO1xuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAndmlld0NvbGxlY3Rpb24gPT4nLCBlcnIgKTtcblx0XHRcdFx0fSApXG5cdFx0XHRcdC5maW5hbGx5KCBmdW5jdGlvbiAoKSB7XG5cdFx0XHRcdFx0aWYgKCArK2xvYWRlZEl0ZW1zID09PSB0b3RhbEl0ZW1zICkge1xuXG5cdFx0XHRcdFx0XHRoZWxpeC5jbGVhckFsbCgpO1xuXHRcdFx0XHRcdFx0RU5HSU5FLnJlc2V0Q2FtZXJhKCk7XG5cdFx0XHRcdFx0XHRoZWxpeC5tYWtlSGVsaXhQb3N0ZXJzKCBhbGxNb3ZpZXMsIDAgKTtcblx0XHRcdFx0XHRcdCRzdGF0ZS5nbyggJ2hlbGl4JyApO1xuXHRcdFx0XHRcdFx0VE1EYi5jbGVhclNlYXJjaCgpO1xuXHRcdFx0XHRcdFx0RVZULmhlbGl4TmVlZHNSZXNldC5lbWl0KCk7XG5cblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0gKTtcblxuXHRcdH0gKTtcblxuXG5cdH07XG5cblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5EUE9JTlRfVVJJJywgJyRodHRwJywgJyRxJywgZnVuY3Rpb24gKCBsb2csIEVORFBPSU5UX1VSSSwgJGh0dHAsICRxICkge1xuXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdjb2xsZWN0aW9uJztcblx0dmFyIGNvbGxlY3Rpb24gPSBudWxsO1xuXG5cdHZhciBmdWxsQ29sbGVjdGlvbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gY3JlYXRlKCBuYW1lICkge1xuXHRcdGNvbGxlY3Rpb24ucHVzaCggeyBjb2xsZWN0aW9uTmFtZTogbmFtZSwgbW92aWVzOiBbXSB9ICk7XG5cdFx0cHV0KCk7XG5cdH1cblxuXHRmdW5jdGlvbiBpc0VtcHR5KCkge1xuXHRcdHJldHVybiBjb2xsZWN0aW9uLmxlbmd0aCA9PT0gMDtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlc29sdmVDb2xsZWN0aW9uKCkge1xuXG5cdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcblxuXHRcdGlmICggY29sbGVjdGlvbiAhPT0gbnVsbCApIHtcblx0XHRcdGRlZmVycmVkLnJlc29sdmUoIGNvbGxlY3Rpb24gKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0JGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcblx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpOicsIHJlcyApO1xuXHRcdFx0XHRcdGlmICggcmVzLmRhdGEgKSB7XG5cdFx0XHRcdFx0XHRjb2xsZWN0aW9uID0gcmVzLmRhdGE7XG5cdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSBbXTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpOicsIGVyciApO1xuXHRcdFx0XHRcdGRlZmVycmVkLnJlamVjdCggZXJyICk7XG5cdFx0XHRcdH0gKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcblxuXHR9XG5cblx0ZnVuY3Rpb24gaGFzSXRlbSggaXRlbUlkLCBzb21lQ29sbGVjdGlvbiApIHtcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gc29tZUNvbGxlY3Rpb24gKSB7XG5cdFx0XHRcdGZvciAoIHZhciBrID0gMDsgayA8IGNvbGxlY3Rpb25baV0ubW92aWVzLmxlbmd0aDsgayArKyApIHtcblx0XHRcdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0ubW92aWVzW2tdID09PSBpdGVtSWQgKSB7XG5cdFx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHV0KCkge1xuXHRcdCRodHRwLnB1dCggREJfRU5EUE9JTlQsIGNvbGxlY3Rpb24sIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXG5cdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbi5wdXQoKTonLCByZXMgKTtcblx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5wdXQoKTonLCBlcnIgKTtcblx0XHRcdH0gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHB1c2goIGl0ZW1JZCwgdG9Db2xsZWN0aW9uICkge1xuXHRcdGlmICggaGFzSXRlbSggaXRlbUlkLCB0b0NvbGxlY3Rpb24gKSApIHtcblx0XHRcdHJldHVybiBmYWxzZTtcblx0XHR9XG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IHRvQ29sbGVjdGlvbiApIHtcblx0XHRcdFx0Y29sbGVjdGlvbltpXS5tb3ZpZXMucHVzaCggaXRlbUlkICk7XG5cdFx0XHRcdHB1dCgpO1xuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVtb3ZlKCBpdGVtSWQsIGluQ29sbGVjdGlvbiApIHtcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gaW5Db2xsZWN0aW9uICkge1xuXHRcdFx0XHRmb3IgKCB2YXIgayA9IDA7IGsgPCBjb2xsZWN0aW9uW2ldLm1vdmllcy5sZW5ndGg7IGsgKysgKSB7XG5cdFx0XHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLm1vdmllc1trXSA9PT0gaXRlbUlkICkge1xuXHRcdFx0XHRcdFx0dmFyIHJlbW92ZWQgPSBjb2xsZWN0aW9uW2ldLm1vdmllcy5zcGxpY2UoIGssIDEgKS5sZW5ndGg7XG5cdFx0XHRcdFx0XHRwdXQoKTtcblx0XHRcdFx0XHRcdHJldHVybiByZW1vdmVkICE9PSAwO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHRmdW5jdGlvbiByZW1vdmVDb2xsZWN0aW9uKCBjb2xsZWN0aW9uTmFtZSApIHtcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gY29sbGVjdGlvbk5hbWUgKSB7XG5cdFx0XHRcdHZhciByZW1vdmVkID0gY29sbGVjdGlvbi5zcGxpY2UoIGksIDEgKS5sZW5ndGg7XG5cdFx0XHRcdHB1dCgpO1xuXHRcdFx0XHRyZXR1cm4gcmVtb3ZlZCAhPT0gMDtcblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gc3luYygpIHtcblx0XHQvLyBzeW5jIGxvY2FsIGNvbGVsY3Rpb24gdy8gREJcblx0fVxuXG5cdGZ1bmN0aW9uIGdldENvbGxlY3Rpb24oKSB7XG5cdFx0cmV0dXJuIGNvbGxlY3Rpb247XG5cdH1cblxuXHRmdW5jdGlvbiBfY2xlYXIoKSB7XG5cdFx0Y29sbGVjdGlvbiA9IG51bGw7XG5cdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdsb2NhbCBjb2xsZWN0aW9uIGNsZWFyZWQuJyApO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRnZXRDb2xsZWN0aW9uLFxuXHRcdGNyZWF0ZSxcblx0XHRwdXNoLFxuXHRcdHB1dCxcblx0XHRyZW1vdmUsXG5cdFx0cmVtb3ZlQ29sbGVjdGlvbixcblx0XHRzeW5jLFxuXHRcdF9jbGVhcixcblx0XHRyZXNvbHZlQ29sbGVjdGlvbixcblx0XHRoYXNJdGVtLFxuXHRcdGlzRW1wdHlcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnJGNhY2hlRmFjdG9yeScsICdtb3ZpZUl0ZW0nLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsICdtb3ZpZUNvbGxlY3Rpb24nLFxuZnVuY3Rpb24oIGxvZywgJHNjb3BlLCBUTURiLCAkY2FjaGVGYWN0b3J5LCBtb3ZpZUl0ZW0sIGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UsIG1vdmllQ29sbGVjdGlvbiApIHtcblxuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS5tb3ZpZUl0ZW0gPSBtb3ZpZUl0ZW07IC8vIG1vdmllSXRlbSBpbmplY3RlZCB2aWEgc3RhdGUgcmVzb2x2ZVxuXHRsb2cuZGVidWcoICdjdHJsJywgJ21vdmllRGV0YWlsIGN0cmwgcmVzb2x2ZWQ6Jywgdm0ubW92aWVJdGVtICk7XG5cblx0bW92aWVJdGVtLmZ1bGxUaXRsZSA9IG1vdmllSXRlbS50aXRsZTtcblx0aWYgKCBtb3ZpZUl0ZW0udGl0bGUgIT09IG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSApIHtcblx0XHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlICsgJyAoJyArIG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSArICcpJztcblx0fVxuXG5cdGlmICggbW92aWVJdGVtLmJhY2tkcm9wX3BhdGggKSB7XG5cdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL29yaWdpbmFsJyArIG1vdmllSXRlbS5iYWNrZHJvcF9wYXRoO1xuXHRcdCQoICcuYmFja2Ryb3AnICkuY3NzKCB7XG5cdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJ1xuXHRcdH0gKTtcblx0fVxuXG5cdHZtLm9wZW5Db2xsZWN0aW9uTW9kYWwgPSBmdW5jdGlvbiAoKSB7XG5cdFx0Y29sbGVjdGlvbk1vZGFsU2VydmljZS5zZXRBY3RpdmVJdGVtKCBtb3ZpZUl0ZW0gKTtcblx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLm9wZW4oKTtcblx0fTtcblxufSBdO1xuIl19
