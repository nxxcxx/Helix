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
			if ($scope.newCollectionName) {
				movieCollection.create($scope.newCollectionName);
				$scope.newCollectionName = '';
				vm.closeEditor();
			}
		};

		vm.addToCollection = function (movieId, collectionName) {
			if (movieCollection.hasItem(movieId, collectionName)) {
				movieCollection.remove(movieId, collectionName);
			} else {
				log.debug('collection', 'addToCollection:', movieId, collectionName);
				var success = movieCollection.push(movieId, collectionName);
				log.debug('collection', 'movieCollection.push', success);
			}
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
//# sourceMappingURL=data:application/json;charset=utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvQVBJL1RNRGIuZmFjLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL2F1dGgvYXV0aC5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvYXV0aC9hdXRoSW50ZXJjZXB0b3IuZmFjLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL2F1dGgvYXV0aFRva2VuLmZhYy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9hdXRoL3NpZ25pbi5jdHJsLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL2F1dGgvc2lnbm91dC5jdHJsLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL2F1dGgvc2lnbnVwLmN0cmwuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvY29tbW9uL2V2ZW50cy5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvY29tbW9uL2xvZy5wdi5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9jb21tb24vdXRpbC5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9jb25maWcvaHR0cENvbmZpZy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9jb25maWcvbG9nQ29uZmlnLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL2NvbmZpZy9yb3V0ZUNvbmZpZy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9kaXJlY3RpdmUvaG92ZXJDbGFzcy5kaXIuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvaGVsaXgvZGlzcGxheS5kaXIuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvaGVsaXgvZW5naW5lLmZhYy5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9oZWxpeC9oZWxpeC5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvaGVsaXgvcG9zdGVyLmRpci5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9pbmRleC5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9tYWluLmN0cmwuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25JdGVtLmRpci5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsLmRpci5qcyIsIi9Vc2Vycy9ueC9EZXYvd2ViL2hlbGl4L3NyYy9tb3ZpZUNvbGxlY3Rpb24vY29sbGVjdGlvbk1vZGFsU2VydmljZS5mYWMuanMiLCIvVXNlcnMvbngvRGV2L3dlYi9oZWxpeC9zcmMvbW92aWVDb2xsZWN0aW9uL21vdmllQ29sbGVjdGlvbi5jdHJsLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL21vdmllQ29sbGVjdGlvbi9tb3ZpZUNvbGxlY3Rpb24uZmFjLmpzIiwiL1VzZXJzL254L0Rldi93ZWIvaGVsaXgvc3JjL21vdmllRGV0YWlsLmN0cmwuanMiXSwibmFtZXMiOltdLCJtYXBwaW5ncyI6IkFBQUE7OztBQ0FBLE1BQU0sQ0FBQyxPQUFPLEdBQUcsQ0FBRSxLQUFLLEVBQUUsT0FBTyxFQUFFLFVBQVUsRUFBRSxLQUFLLEVBQUUsZUFBZSxFQUFFLElBQUksRUFBRSxjQUFjLEVBQzNGLFVBQVcsR0FBRyxFQUFFLEtBQUssRUFBRSxRQUFRLEVBQUUsR0FBRyxFQUFFLGFBQWEsRUFBRSxFQUFFLEVBQUUsWUFBWSxFQUFHOztBQUV2RSxLQUFJLFlBQVksR0FBRyxFQUFFLENBQUM7QUFDdEIsS0FBSSxVQUFVLEdBQUcsQ0FBQyxDQUFDLENBQUM7QUFDcEIsS0FBSSxRQUFRLEdBQUcsQ0FBQyxDQUFDOztBQUVqQixLQUFJLFlB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QUFFLENBQUMiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJGh0dHAnLCAnVE1EQl9BUEknLCAnRVZUJywgJyRjYWNoZUZhY3RvcnknLCAnJHEnLCAnRU5EUE9JTlRfVVJJJyxcbmZ1bmN0aW9uICggbG9nLCAkaHR0cCwgVE1EQl9BUEksIEVWVCwgJGNhY2hlRmFjdG9yeSwgJHEsIEVORFBPSU5UX1VSSSApIHtcblxuXHR2YXIgc2VhcmNoUmVzdWx0ID0gW107XG5cdHZhciB0b3RhbFBhZ2VzID0gLTE7XG5cdHZhciBjdXJyUGFnZSA9IDE7XG5cblx0dmFyIG1vdmllSWRDYWNoZSA9ICRjYWNoZUZhY3RvcnkoICdtb3ZpZUlkQ2FjaGUnICk7XG5cdC8vIFRNREJfQVBJLnVybCArICdtb3ZpZS9ub3dfcGxheWluZydcblxuXHR2YXIgREJfRU5EUE9JTlQgPSBFTkRQT0lOVF9VUkkgKyAnbW92aWUvJztcblxuXHRmdW5jdGlvbiBwdXRJdGVtVG9EQiggbW92aWVJdGVtICkge1xuXHRcdCRodHRwLnB1dCggREJfRU5EUE9JTlQgKyBtb3ZpZUl0ZW0uaWQsIG1vdmllSXRlbSApXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgJ1BVVDonLCByZXMgKTtcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2VycicsICdQVVQ6JywgZXJyICk7XG5cdFx0fSApO1xuXHR9XG5cblx0ZnVuY3Rpb24gc2VhcmNoSWRGcm9tREIoIGlkICkge1xuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCArIGlkIClcblx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBEQjonLCByZXMuZGF0YSApO1xuXHRcdFx0aWYgKCByZXMuZGF0YSApIHtcblx0XHRcdFx0bW92aWVJZENhY2hlLnB1dCggcmVzLmRhdGEuaWQsIHJlcy5kYXRhICk7XG5cdFx0XHRcdHJldHVybiByZXMuZGF0YTtcblx0XHRcdH0gZWxzZSB7XG5cdFx0XHRcdHJldHVybiBudWxsO1xuXHRcdFx0fVxuXHRcdH0sIGZ1bmN0aW9uKCBlcnIgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBEQjonLCBlcnIgKTtcblx0XHR9ICk7XG5cdFx0cmV0dXJuIHByb21pc2U7XG5cdH1cblxuXHRmdW5jdGlvbiBzZWFyY2hJZEZyb21BUEkoIGlkICkge1xuXHRcdHZhciBwcm9taXNlID0gJGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnbW92aWUvJyArIGlkLCB7XG5cdFx0XHRwYXJhbXM6IHsgYXBpX2tleTogVE1EQl9BUEkua2V5IH1cblx0XHR9ICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgcmVzLmRhdGEgKTtcblx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIHJlcy5kYXRhLmlkLCByZXMuZGF0YSApO1xuXHRcdFx0cHV0SXRlbVRvREIoIHJlcy5kYXRhICk7XG5cdFx0XHRyZXR1cm4gcmVzLmRhdGE7XG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2VhcmNoQnlJZCA9PiBBUEk6JywgZXJyICk7XG5cdFx0fSApO1xuXHRcdHJldHVybiBwcm9taXNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gc2VhcmNoQnlJZCggaWQgKSB7XG5cblx0XHR2YXIgZGZfREIgPSAkcS5kZWZlcigpO1xuXHRcdHZhciBkZl9SZXMgPSAkcS5kZWZlcigpO1xuXG5cdFx0dmFyIGNhY2hlZEl0ZW0gPSBtb3ZpZUlkQ2FjaGUuZ2V0KCBpZCApO1xuXHRcdGlmICggY2FjaGVkSXRlbSApIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2FwaScsICdzZWFyY2hCeUlkID0+IGNhY2hlOicsIGNhY2hlZEl0ZW0gKTtcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCBjYWNoZWRJdGVtICk7XG5cdFx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XG5cdFx0fVxuXG5cdFx0c2VhcmNoSWRGcm9tREIoIGlkICkudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRpZiAoIHJlcyApIHtcblx0XHRcdFx0ZGZfREIucmVzb2x2ZSggcmVzICk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRkZl9EQi5yZWplY3QoICdub3QgZm91bmQnICk7XG5cdFx0XHR9XG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRcdGRmX0RCLnJlamVjdCggZXJyICk7XG5cdFx0fSApO1xuXG5cdFx0ZGZfREIucHJvbWlzZS50aGVuKCBmdW5jdGlvbiAoIHJlc19EQiApIHtcblx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfREIgKTtcblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdHNlYXJjaElkRnJvbUFQSSggaWQgKS50aGVuKCBmdW5jdGlvbiAoIHJlc19hcGkgKSB7XG5cdFx0XHRcdGRmX1Jlcy5yZXNvbHZlKCByZXNfYXBpICk7XG5cdFx0XHR9LCBmdW5jdGlvbiAoIGVycl9hcGkgKSB7XG5cdFx0XHRcdGRmX1Jlcy5yZWplY3QoIGVycl9hcGkgKTtcblx0XHRcdH0gKTtcblx0XHR9ICk7XG5cblx0XHRyZXR1cm4gZGZfUmVzLnByb21pc2U7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHNlYXJjaEJ5VGl0bGUoIHNlYXJjaE9iaiApIHtcblxuXHRcdGlmICggY3VyclBhZ2UgPiB0b3RhbFBhZ2VzICYmIHRvdGFsUGFnZXMgIT09IC0xICkge1xuXHRcdFx0Ly8gZW1pdCBldmVudCBlbmQgb2YgcGFnZVxuXHRcdFx0RVZULkVPUC5lbWl0KCk7XG5cdFx0XHRyZXR1cm47XG5cdFx0fVxuXG5cdFx0JGh0dHAuZ2V0KCBUTURCX0FQSS51cmwgKyAnc2VhcmNoL21vdmllJywge1xuXHRcdFx0Y2FjaGU6IHRydWUsXG5cdFx0XHRwYXJhbXM6IHtcblx0XHRcdFx0YXBpX2tleTogVE1EQl9BUEkua2V5LFxuXHRcdFx0XHRxdWVyeTogc2VhcmNoT2JqLnF1ZXJ5LFxuXHRcdFx0XHRwYWdlOiBjdXJyUGFnZVxuXHRcdFx0fVxuXHRcdH0gKVxuXHRcdC50aGVuKCBmdW5jdGlvbiAoIHJlcyApIHtcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIHN1Y2Nlc3Ncblx0XHRcdHNlYXJjaFJlc3VsdCA9IHNlYXJjaFJlc3VsdC5jb25jYXQoIHJlbW92ZU5vUG9zdGVySXRlbXMoIHJlcy5kYXRhLnJlc3VsdHMgKSApO1xuXHRcdFx0dG90YWxQYWdlcyA9IHJlcy5kYXRhLnRvdGFsX3BhZ2VzO1xuXHRcdFx0Y3VyclBhZ2UgKys7XG5cdFx0XHRsb2cuZGVidWcoICdhcGknLCAnc2VhcmNoQnlUaXRsZTonLCByZXMsIHJlcy5kYXRhICk7XG5cblx0XHRcdC8vIGNhY2hlXG5cdFx0XHRyZXMuZGF0YS5yZXN1bHRzLmZvckVhY2goIGZ1bmN0aW9uICggaXRlbSApIHtcblxuXHRcdFx0XHRpZiAoICFtb3ZpZUlkQ2FjaGUuZ2V0KCBpdGVtLmlkICkgKSB7XG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnYXBpJywgaXRlbS5pZCwgaXRlbSApO1xuXHRcdFx0XHRcdG1vdmllSWRDYWNoZS5wdXQoIGl0ZW0uaWQsIGl0ZW0gKTtcblx0XHRcdFx0fVxuXG5cdFx0XHR9ICk7XG5cblx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdC8vIGVtaXQgZXZlbnQgc2VhcmNoIGVyclxuXHRcdFx0bG9nLmRlYnVnKCAnZXJyJywgJ3NlYXJjaEJ5VGl0bGU6JywgZXJyICk7XG5cdFx0fSApO1xuXG5cdH1cblxuXHRmdW5jdGlvbiByZW1vdmVOb1Bvc3Rlckl0ZW1zKCByZXN1bHRzICkge1xuXHRcdHJldHVybiByZXN1bHRzLmZpbHRlciggZnVuY3Rpb24gKCBpdGVtICkge1xuXHRcdFx0cmV0dXJuICEhaXRlbS5wb3N0ZXJfcGF0aDtcblx0XHR9ICk7XG5cdH1cblxuXHRmdW5jdGlvbiBnZXRSZXMoKSB7XG5cdFx0cmV0dXJuIHNlYXJjaFJlc3VsdDtcblx0fVxuXG5cdGZ1bmN0aW9uIGNsZWFyU2VhcmNoKCkge1xuXHRcdC8vIGVtaXQgZXZlbnQgY2xlYXJTZWFjaFxuXHRcdHNlYXJjaFJlc3VsdC5sZW5ndGggPSAwO1xuXHRcdHRvdGFsUGFnZXMgPSAtMTtcblx0XHRjdXJyUGFnZSA9IDE7XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHNlYXJjaEJ5VGl0bGUsXG5cdFx0c2VhcmNoQnlJZCxcblx0XHRjbGVhclNlYXJjaCxcblx0XHRnZXRSZXMsXG5cdFx0cHV0SXRlbVRvREIsXG5cdFx0bW92aWVJZENhY2hlXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ0VORFBPSU5UX1VSSScsICckaHR0cCcsICckcScsICdhdXRoVG9rZW4nLFxuZnVuY3Rpb24gKCBsb2csIEVORFBPSU5UX1VSSSwgJGh0dHAsICRxLCBhdXRoVG9rZW4gKSB7XG5cblx0XHR2YXIgaWRlbnRpdHkgPSBudWxsO1xuXHRcdHZhciBfaWRlbnRpdHlSZXNvbHZlZCA9IGZhbHNlO1xuXG5cdFx0ZnVuY3Rpb24gYXV0aG9yaXplKCBmb3JjZSApIHtcblxuXHRcdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcblxuXHRcdFx0aWYgKCBmb3JjZSApIGlkZW50aXR5ID0gbnVsbDtcblxuXHRcdFx0aWYgKCBpZGVudGl0eSAhPT0gbnVsbCApIHtcblxuXHRcdFx0XHRkZWZlcnJlZC5yZXNvbHZlKCB0cnVlICk7XG5cblx0XHRcdH0gZWxzZSB7XG5cblx0XHRcdFx0JGh0dHAuZ2V0KCBFTkRQT0lOVF9VUkkgKyAnYXV0aCcsIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXG5cdFx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXG5cdFx0XHRcdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ2F1dGguYXV0aG9yaXplKCk6JywgcmVzLCByZXMuZGF0YSApO1xuXHRcdFx0XHRcdFx0aWRlbnRpdHkgPSByZXMuZGF0YTtcblx0XHRcdFx0XHRcdF9pZGVudGl0eVJlc29sdmVkID0gdHJ1ZTtcblx0XHRcdFx0XHRcdGRlZmVycmVkLnJlc29sdmUoIHRydWUgKTtcblxuXHRcdFx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXG5cdFx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnYXV0aG9yaXplJywgZXJyLCBlcnIuZGF0YSApO1xuXHRcdFx0XHRcdFx0Ly8gdG9kbyBpZiBqd3QgZXhwaXJlZCAsIGRlYXV0aG9yaXplLCByZW1vdmUgbG9jYWwgc3RvcmFnZSwgcmVkaXJlY3Rcblx0XHRcdFx0XHRcdF9pZGVudGl0eVJlc29sdmVkID0gdHJ1ZTtcblx0XHRcdFx0XHRcdGRlZmVycmVkLnJlamVjdCggZXJyICk7XG5cblx0XHRcdFx0XHR9ICk7XG5cblx0XHRcdH1cblxuXHRcdFx0cmV0dXJuIGRlZmVycmVkLnByb21pc2U7XG5cblx0XHR9XG5cblx0XHRmdW5jdGlvbiBkZWF1dGhvcml6ZSgpIHtcblx0XHRcdGF1dGhUb2tlbi5yZW1vdmVUb2tlbigpO1xuXHRcdFx0aWRlbnRpdHkgPSBudWxsO1xuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIGlzQXV0aGVudGljYXRlZCgpIHtcblx0XHRcdHJldHVybiBpZGVudGl0eSAhPT0gbnVsbDtcblx0XHR9XG5cblx0XHRmdW5jdGlvbiBpZGVudGl0eVJlc29sdmVkKCkge1xuXHRcdFx0cmV0dXJuIF9pZGVudGl0eVJlc29sdmVkO1xuXHRcdH1cblxuXHRcdHJldHVybiB7XG5cblx0XHRcdGF1dGhvcml6ZSxcblx0XHRcdGRlYXV0aG9yaXplLFxuXHRcdFx0aXNBdXRoZW50aWNhdGVkLFxuXHRcdFx0aWRlbnRpdHlSZXNvbHZlZFxuXG5cdFx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdhdXRoVG9rZW4nLCBmdW5jdGlvbiAoIGF1dGhUb2tlbiApIHtcblxuXHRmdW5jdGlvbiByZXF1ZXN0KCBjb25maWcgKSB7XG5cblx0XHRpZiAoIGNvbmZpZy5yZXF1aXJlQXV0aCApIHtcblx0XHRcdHZhciB0b2tlbiA9IGF1dGhUb2tlbi5nZXRUb2tlbigpO1xuXHRcdFx0aWYgKCB0b2tlbiApIHtcblx0XHRcdFx0Ly8gaHR0cDovL3NlbGYtaXNzdWVkLmluZm8vZG9jcy9kcmFmdC1pZXRmLW9hdXRoLXYyLWJlYXJlci5odG1sICAgc2VjdGlvbiAyLjFcblx0XHRcdFx0Ly8gaHR0cHM6Ly9kZXZlbG9wZXJzLmdvb2dsZS5jb20vZ21haWwvbWFya3VwL2FjdGlvbnMvdmVyaWZ5aW5nLWJlYXJlci10b2tlbnNcblx0XHRcdFx0Ly8gaHR0cDovL3d3dy53My5vcmcvUHJvdG9jb2xzL3JmYzI2MTYvcmZjMjYxNi1zZWM0Lmh0bWwgc2VjdGlvbiA0LjIgaGVhZGVyIGZpZWxkIG5hbWUgY2FzZSBpbnNlbnNpdGl2ZVxuXHRcdFx0XHRjb25maWcuaGVhZGVycy5BdXRob3JpemF0aW9uID0gJ0JlYXJlciAnICsgdG9rZW47XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIGNvbmZpZztcblxuXHR9XG5cblx0ZnVuY3Rpb24gcmVzcG9uc2UoIHJlcyApIHtcblx0XHRyZXR1cm4gcmVzO1xuXHR9XG5cblx0cmV0dXJuIHtcblxuXHRcdHJlcXVlc3QsXG5cdFx0cmVzcG9uc2VcblxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckd2luZG93JywgZnVuY3Rpb24gKCBsb2csICR3aW5kb3cgKSB7XG5cblx0dmFyIHN0b3JhZ2UgPSAkd2luZG93LmxvY2FsU3RvcmFnZTtcblx0dmFyIGNhY2hlZFRva2VuID0gbnVsbDtcblxuXHRmdW5jdGlvbiBzZXRUb2tlbiggdG9rZW4gKSB7XG5cdFx0Y2FjaGVkVG9rZW4gPSB0b2tlbjtcblx0XHRzdG9yYWdlLnNldEl0ZW0oICdqd3QnLCB0b2tlbiApO1xuXHR9XG5cblx0ZnVuY3Rpb24gZ2V0VG9rZW4oKSB7XG5cdFx0aWYgKCAhY2FjaGVkVG9rZW4gKSB7XG5cdFx0XHRjYWNoZWRUb2tlbiA9IHN0b3JhZ2UuZ2V0SXRlbSggJ2p3dCcgKTtcblx0XHR9XG5cdFx0cmV0dXJuIGNhY2hlZFRva2VuO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVtb3ZlVG9rZW4oKSB7XG5cdFx0Y2FjaGVkVG9rZW4gPSBudWxsO1xuXHRcdHN0b3JhZ2UucmVtb3ZlSXRlbSggJ2p3dCcgKTtcblx0XHRsb2cuZGVidWcoICdhdXRoJywgJ3Rva2VuIHJlbW92ZWQnICk7XG5cdH1cblxuXHRmdW5jdGlvbiBoYXNUb2tlbigpIHtcblx0XHRyZXR1cm4gISFnZXRUb2tlbigpO1xuXHR9XG5cblx0cmV0dXJuIHtcblxuXHRcdHNldFRva2VuLFxuXHRcdGdldFRva2VuLFxuXHRcdHJlbW92ZVRva2VuLFxuXHRcdGhhc1Rva2VuXG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJyRodHRwJywgJ0VORFBPSU5UX1VSSScsICdhdXRoVG9rZW4nLCAnJHN0YXRlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsICRodHRwLCBFTkRQT0lOVF9VUkksIGF1dGhUb2tlbiwgJHN0YXRlICkgIHtcblxuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS51c2VyID0ge1xuXHRcdGVtYWlsOiAnJyxcblx0XHRwYXNzd29yZDogJydcblx0fTtcblxuXHR2bS5zaWduaW4gPSBmdW5jdGlvbigpIHtcblxuXHRcdGlmICggdm0udXNlci5lbWFpbCA9PT0gJycgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gJycgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xuXHRcdFx0cmV0dXJuO1xuXHRcdH1cblxuXHRcdCRodHRwLnBvc3QoIEVORFBPSU5UX1VSSSArICdzaWduaW4nLCB2bS51c2VyIClcblx0XHRcdC50aGVuKCBmdW5jdGlvbiggcmVzICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICdhdXRoJywgJ3NpZ25pbicsIHJlcywgcmVzLmRhdGEgKTtcblx0XHRcdFx0YXV0aFRva2VuLnNldFRva2VuKCByZXMuZGF0YS50b2tlbiApO1xuXHRcdFx0XHQkc3RhdGUuZ28oICdjb2xsZWN0aW9uJyApO1xuXHRcdFx0fSwgZnVuY3Rpb24oIGVyciwgc3RhdHVzICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnc2lnbmluJywgZXJyICk7XG5cdFx0XHR9ICk7XG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICckc3RhdGUnLCAnYXV0aCcsICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoICRzdGF0ZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uICkgIHtcblxuXHRhdXRoLmRlYXV0aG9yaXplKCk7XG5cdG1vdmllQ29sbGVjdGlvbi5fY2xlYXIoKTtcblx0JHN0YXRlLmdvKCAnc2lnbmluJyApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICckc2NvcGUnLCAnJGh0dHAnLCAnRU5EUE9JTlRfVVJJJywgJ2F1dGhUb2tlbicsICckc3RhdGUnLFxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgJGh0dHAsIEVORFBPSU5UX1VSSSwgYXV0aFRva2VuLCAkc3RhdGUgKSB7XG5cblx0XHR2YXIgdm0gPSB0aGlzO1xuXHRcdHZtLnVzZXIgPSB7fTtcblxuXHRcdHZtLnNpZ251cCA9IGZ1bmN0aW9uICgpIHtcblxuXHRcdFx0aWYgKCB2bS51c2VyLmVtYWlsID09PSB1bmRlZmluZWQgfHwgdm0udXNlci5wYXNzd29yZCA9PT0gdW5kZWZpbmVkICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICd3YXJuJywgJ2VtYWlsICYgcGFzc3dvcmQgcmVxdWlyZWQuJyApO1xuXHRcdFx0XHRyZXR1cm47XG5cdFx0XHR9XG5cblx0XHRcdGxvZy5kZWJ1ZyggJ2F1dGgnLCAnc2lnbmluZyB1cC4uLicgKTtcblx0XHRcdCRodHRwLnBvc3QoIEVORFBPSU5UX1VSSSArICdzaWdudXAnLCB2bS51c2VyIClcblx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXG5cdFx0XHRcdFx0bG9nLmRlYnVnKCAnYXV0aCcsICdSZWdpc3RlcmVkLicsIHJlcyApO1xuXG5cdFx0XHRcdFx0YXV0aFRva2VuLnNldFRva2VuKCByZXMuZGF0YS50b2tlbiApO1xuXHRcdFx0XHRcdCRzdGF0ZS5nbyggJ2NvbGxlY3Rpb24nICk7XG5cblx0XHRcdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCBlcnIgKTtcblx0XHRcdFx0XHR2bS5mb3JtLiRzdWJtaXR0ZWQgPSBmYWxzZTtcblxuXHRcdFx0XHR9ICk7XG5cblx0XHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRyb290U2NvcGUnLCBmdW5jdGlvbiAoICRyb290U2NvcGUgKSB7XG5cblx0dmFyIEVWVCA9IHtcblxuXHRcdEVPUDoge1xuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ0VPUCcsIGNiICk7IH0sXG5cdFx0XHRlbWl0OiBmdW5jdGlvbiAoKSB7ICRyb290U2NvcGUuJGJyb2FkY2FzdCggJ0VPUCcgKTsgfVxuXHRcdH0sXG5cdFx0Y29sbGVjdGlvbk1vZGFsT3Blbjoge1xuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ2NvbGxlY3Rpb25Nb2RhbE9wZW4nLCBjYiApOyB9LFxuXHRcdFx0ZW1pdDogZnVuY3Rpb24gKCkgeyAkcm9vdFNjb3BlLiRicm9hZGNhc3QoICdjb2xsZWN0aW9uTW9kYWxPcGVuJyApOyB9XG5cdFx0fSxcblx0XHRjb2xsZWN0aW9uTW9kYWxDbG9zZToge1xuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJywgY2IgKTsgfSxcblx0XHRcdGVtaXQ6IGZ1bmN0aW9uICgpIHsgJHJvb3RTY29wZS4kYnJvYWRjYXN0KCAnY29sbGVjdGlvbk1vZGFsQ2xvc2UnICk7IH1cblx0XHR9LFxuXHRcdGhlbGl4TmVlZHNSZXNldDoge1xuXHRcdFx0bGlzdGVuOiBmdW5jdGlvbiAoIGNiICkgeyAkcm9vdFNjb3BlLiRvbiggJ2hlbGl4TmVlZHNSZXNldCcsIGNiICk7IH0sXG5cdFx0XHRlbWl0OiBmdW5jdGlvbiAoKSB7ICRyb290U2NvcGUuJGJyb2FkY2FzdCggJ2hlbGl4TmVlZHNSZXNldCcgKTsgfVxuXHRcdH1cblxuXHR9O1xuXG5cdHJldHVybiBFVlQ7XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyBmdW5jdGlvbiAoKSB7XG5cblx0dmFyIGRlYnVnRW5hYmxlZCA9IGZhbHNlO1xuXHR2YXIgZGVidWdOYW1lc3BhY2VzID0gW107XG5cblx0dGhpcy5lbmFibGVEZWJ1ZyA9IGZ1bmN0aW9uICgpIHtcblx0XHRkZWJ1Z0VuYWJsZWQgPSB0cnVlO1xuXHR9O1xuXG5cdHRoaXMuZW5hYmxlRGVidWdOYW1lc3BhY2UgPSBmdW5jdGlvbiAoKSB7XG5cdFx0Zm9yICggbGV0IGkgPSAwOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrICkge1xuXHRcdFx0ZGVidWdOYW1lc3BhY2VzLnB1c2goIGFyZ3VtZW50c1sgaSBdICk7XG5cdFx0fVxuXHR9O1xuXG5cdHRoaXMuJGdldCA9ICgpID0+IHtcblxuXHRcdGZ1bmN0aW9uIGRlYnVnKCkge1xuXHRcdFx0aWYgKCAhZGVidWdFbmFibGVkICkgcmV0dXJuO1xuXHRcdFx0dmFyIGRlYnVnTmFtZSA9IGFyZ3VtZW50c1sgMCBdO1xuXHRcdFx0dmFyIHNsaWNlZEFyZ3MgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuY2FsbCggYXJndW1lbnRzLCAxICk7XG5cdFx0XHRpZiAoIGRlYnVnTmFtZSA9PT0gJ2VycicgKSB7XG5cdFx0XHRcdGNvbnNvbGUuZXJyb3IuYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ2luZm8nICkge1xuXHRcdFx0XHRjb25zb2xlLmluZm8uYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZSA9PT0gJ3dhcm4nICkge1xuXHRcdFx0XHRjb25zb2xlLndhcm4uYXBwbHkoIGNvbnNvbGUsIHNsaWNlZEFyZ3MgKTtcblx0XHRcdH0gZWxzZSBpZiAoIGRlYnVnTmFtZXNwYWNlcy5pbmRleE9mKCBkZWJ1Z05hbWUgKSAhPT0gLTEgKSB7XG5cdFx0XHRcdGNvbnNvbGUubG9nLmFwcGx5KCBjb25zb2xlLCBbIGRlYnVnTmFtZSBdLmNvbmNhdCggc2xpY2VkQXJncyApICk7XG5cdFx0XHR9XG5cdFx0fVxuXG5cdFx0cmV0dXJuIHtcblx0XHRcdGRlYnVnXG5cdFx0fTtcblxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgZnVuY3Rpb24gKCkge1xuXG5cdGZ1bmN0aW9uIGRlYm91bmNlKCBmdW5jLCB3YWl0LCBpbW1lZGlhdGUgKSB7XG5cdFx0dmFyIF90aGlzID0gdGhpcyxcblx0XHRcdF9hcmd1bWVudHMgPSBhcmd1bWVudHM7XG5cblx0XHR2YXIgdGltZW91dDtcblx0XHRyZXR1cm4gZnVuY3Rpb24gKCkge1xuXG5cdFx0XHR2YXIgY29udGV4dCA9IF90aGlzLFxuXHRcdFx0XHRhcmdzID0gX2FyZ3VtZW50cztcblx0XHRcdHZhciBsYXRlciA9IGZ1bmN0aW9uIGxhdGVyKCkge1xuXG5cdFx0XHRcdHRpbWVvdXQgPSBudWxsO1xuXHRcdFx0XHRpZiAoICFpbW1lZGlhdGUgKSBmdW5jLmFwcGx5KCBjb250ZXh0LCBhcmdzICk7XG5cdFx0XHR9O1xuXHRcdFx0dmFyIGNhbGxOb3cgPSBpbW1lZGlhdGUgJiYgIXRpbWVvdXQ7XG5cdFx0XHRjbGVhclRpbWVvdXQoIHRpbWVvdXQgKTtcblx0XHRcdHRpbWVvdXQgPSBzZXRUaW1lb3V0KCBsYXRlciwgd2FpdCApO1xuXHRcdFx0aWYgKCBjYWxsTm93ICkgZnVuYy5hcHBseSggY29udGV4dCwgYXJncyApO1xuXHRcdH07XG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdGRlYm91bmNlXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJGh0dHBQcm92aWRlcicsIGZ1bmN0aW9uICggJGh0dHBQcm92aWRlciApIHtcblx0JGh0dHBQcm92aWRlci5pbnRlcmNlcHRvcnMucHVzaCggJ2F1dGhJbnRlcmNlcHRvcicgKTtcbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nUHJvdmlkZXInLCAnJGh0dHBQcm92aWRlcicsIGZ1bmN0aW9uICggbG9nUHJvdmlkZXIsICRodHRwUHJvdmlkZXIgKSB7XG5cblx0bG9nUHJvdmlkZXIuZW5hYmxlRGVidWcoKTtcblx0Ly8gbG9nUHJvdmlkZXIuZW5hYmxlRGVidWdOYW1lc3BhY2UoICdpbmZvJywgJ2VycicsICdhdXRoJywgJ2FwaScsICdjb2xsZWN0aW9uJyApO1xuXHRsb2dQcm92aWRlci5lbmFibGVEZWJ1Z05hbWVzcGFjZSggJ2luZm8nLCAnZXJyJyApO1xuXG5cdCRodHRwUHJvdmlkZXIudXNlTGVnYWN5UHJvbWlzZUV4dGVuc2lvbnMoIGZhbHNlICk7XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHN0YXRlUHJvdmlkZXInLCAnJHVybFJvdXRlclByb3ZpZGVyJywgJyRodHRwUHJvdmlkZXInLFxuZnVuY3Rpb24gKCAkc3RhdGVQcm92aWRlciwgJHVybFJvdXRlclByb3ZpZGVyLCAkaHR0cFByb3ZpZGVyICkge1xuXG5cdCR1cmxSb3V0ZXJQcm92aWRlci5vdGhlcndpc2UoICcvJyApO1xuXG5cdCRzdGF0ZVByb3ZpZGVyXG5cdFx0LnN0YXRlKCAnaGVsaXgnLCB7XG5cdFx0XHR1cmw6ICcvJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9oZWxpeC5odG1sJ1xuXHRcdH0gKVxuXHRcdC5zdGF0ZSggJ3NpZ251cCcsIHtcblx0XHRcdHVybDogJy9zaWdudXAnLFxuXHRcdFx0dGVtcGxhdGVVcmw6ICcuL3RlbXBsYXRlL3NpZ251cC5odG1sJyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdudXBDdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ3NpZ251cCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdzaWduaW4nLCB7XG5cdFx0XHR1cmw6ICcvc2lnbmluJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9zaWduaW4uaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnc2lnbmluQ3RybCcsXG5cdFx0XHRjb250cm9sbGVyQXM6ICdzaWduaW4nXG5cdFx0fSApXG5cdFx0LnN0YXRlKCAnc2lnbm91dCcsIHtcblx0XHRcdHVybDogJy9zaWdub3V0Jyxcblx0XHRcdGNvbnRyb2xsZXI6ICdzaWdub3V0Q3RybCdcblx0XHR9IClcblx0XHQuc3RhdGUoICdtb3ZpZURldGFpbCcsIHtcblx0XHRcdHVybDogJy9tb3ZpZS86bW92aWVJZCcsXG5cdFx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvbW92aWVEZXRhaWwuaHRtbCcsXG5cdFx0XHRjb250cm9sbGVyOiAnbW92aWVEZXRhaWxDdHJsJyxcblx0XHRcdGNvbnRyb2xsZXJBczogJ21kJyxcblx0XHRcdHJlc29sdmU6IHtcblx0XHRcdFx0bW92aWVJdGVtOiBbICckc3RhdGVQYXJhbXMnLCAnVE1EYicsIGZ1bmN0aW9uICggJHN0YXRlUGFyYW1zLCBUTURiICkge1xuXHRcdFx0XHRcdHJldHVybiBUTURiLnNlYXJjaEJ5SWQoICRzdGF0ZVBhcmFtcy5tb3ZpZUlkICk7XG5cdFx0XHRcdH0gXVxuXHRcdFx0fVxuXHRcdH0gKVxuXHRcdC5zdGF0ZSgnY29sbGVjdGlvbicsIHtcblx0XHRcdHVybDogJy9jb2xsZWN0aW9uJyxcblx0XHRcdHRlbXBsYXRlVXJsOiAnLi90ZW1wbGF0ZS9jb2xsZWN0aW9uLmh0bWwnLFxuXHRcdFx0Y29udHJvbGxlcjogJ21vdmllQ29sbGVjdGlvbkN0cmwnLFxuXHRcdFx0Y29udHJvbGxlckFzOiAnbWMnLFxuXHRcdFx0cmVzb2x2ZToge1xuXHRcdFx0XHRhdXRob3JpemU6IFsgJ2F1dGgnLCBmdW5jdGlvbiAoIGF1dGggKSB7XG5cdFx0XHRcdFx0cmV0dXJuIGF1dGguYXV0aG9yaXplKCk7XG5cdFx0XHRcdH0gXSxcblx0XHRcdFx0cmVzb2x2ZWRDb2xsZWN0aW9uOiBbICdtb3ZpZUNvbGxlY3Rpb24nLCBmdW5jdGlvbiAoIG1vdmllQ29sbGVjdGlvbiApIHtcblx0XHRcdFx0XHRyZXR1cm4gbW92aWVDb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk7XG5cdFx0XHRcdH0gXVxuXHRcdFx0fVxuXHRcdH0pXG5cdDtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbIGZ1bmN0aW9uICgpIHtcblxuXHRmdW5jdGlvbiBsaW5rKCAkc2NvcGUsICRlbGVtZW50LCAkYXR0cnMgKSB7XG5cblx0XHQkZWxlbWVudFxuXHRcdC5vbiggJ21vdXNlZW50ZXInLCBmdW5jdGlvbiAoKSB7XG5cdFx0XHQkZWxlbWVudC5yZW1vdmVDbGFzcyggJGF0dHJzLmxlYXZlICk7XG5cdFx0XHQkZWxlbWVudC5hZGRDbGFzcyggJGF0dHJzLmhvdmVyICk7XG5cdFx0fSApXG5cdFx0Lm9uKCAnbW91c2VsZWF2ZScsIGZ1bmN0aW9uICgpIHtcblx0XHRcdCRlbGVtZW50LnJlbW92ZUNsYXNzKCAkYXR0cnMuaG92ZXIgKTtcblx0XHRcdCRlbGVtZW50LmFkZENsYXNzKCAkYXR0cnMubGVhdmUgKTtcblx0XHR9ICk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVzdHJpY3Q6ICdBJyxcblx0XHRsaW5rOiBsaW5rXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHdpbmRvdycsICdFTkdJTkUnLCAndXRpbCcsIGZ1bmN0aW9uICggJHdpbmRvdywgRU5HSU5FLCB1dGlsICkge1xuXG5cdGZ1bmN0aW9uIGN0cmwoICRzY29wZSwgJGVsZW1lbnQgKSB7XG5cblx0XHRFTkdJTkUuYXR0YWNoUmVuZGVyZXIoICRlbGVtZW50ICk7XG5cdFx0JCggJHdpbmRvdyApLm9uKCAncmVzaXplJywgdXRpbC5kZWJvdW5jZSggRU5HSU5FLm9uV2luZG93UmVzaXplLCAxMDAgKSApO1xuXHRcdCRlbGVtZW50Lm9uKCAnd2hlZWwnLCBmdW5jdGlvbiAoIGV2dCApIHtcblx0XHRcdEVOR0lORS4kJC53aGVlbF9keSA9IC1NYXRoLnNpZ24oIGV2dC5vcmlnaW5hbEV2ZW50LmRlbHRhWSApO1xuXHRcdH0gKTtcblxuXHRcdEVOR0lORS5zdGFydCgpO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXHRcdHJlc3RyaWN0OiAnRScsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHRjb250cm9sbGVyOiBjdHJsLFxuXHRcdHRlbXBsYXRlOiAnPGRpdiBpZD1cImNhbnZhcy1jb250YWluZXJcIj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnJHdpbmRvdycsIGZ1bmN0aW9uICggJHdpbmRvdyApIHtcblxuXHR2YXIgJCQgPSB7XG5cdFx0Y2FudmFzOiBudWxsLFxuXHRcdHN0YXRzOiBuZXcgU3RhdHMoKSxcblx0XHRzY2VuZTogbmV3IFRIUkVFLlNjZW5lKCksXG5cdFx0d2lkdGg6ICQod2luZG93KS53aWR0aCgpLFxuXHRcdGhlaWdodDogJCh3aW5kb3cpLmhlaWdodCgpLFxuXHRcdGNhbWVyYTogbmV3IFRIUkVFLlBlcnNwZWN0aXZlQ2FtZXJhKCA3MCwgdGhpcy53aWR0aCAvIHRoaXMuaGVpZ2h0LCAxMCwgMTAwMDAwICksXG5cdFx0cmVuZGVyZXI6IG5ldyBUSFJFRS5DU1MzRFJlbmRlcmVyKCksXG5cdFx0c2NyZWVuX3JhdGlvOiB0aGlzLndpZHRoIC8gdGhpcy5oZWlnaHQsXG5cdFx0cGl4ZWxfcmF0aW86ICR3aW5kb3cuZGV2aWNlUGl4ZWxSYXRpbyB8fCAxLFxuXHRcdG1vdXNlX3g6IHRoaXMud2lkdGggKiAwLjUsXG5cdFx0bW91c2VfeTogdGhpcy5oZWlnaHQgKiAwLjUsXG5cdFx0d2hlZWxfZHk6IDBcblx0fTtcblxuXHQkJC5yZW5kZXJlci5zZXRTaXplKCAkJC53aWR0aCwgJCQuaGVpZ2h0ICk7XG5cblx0ZnVuY3Rpb24gYXR0YWNoUmVuZGVyZXIoIGNhbnZhcyApIHtcblx0XHQkJC5jYW52YXMgPSBjYW52YXM7XG5cdFx0Y2FudmFzLmFwcGVuZCggJCQucmVuZGVyZXIuZG9tRWxlbWVudCApO1xuXHRcdGNhbnZhcy5hcHBlbmQoICQkLnN0YXRzLmRvbUVsZW1lbnQgKTtcblx0fVxuXG5cdGZ1bmN0aW9uIG9uV2luZG93UmVzaXplKCkge1xuXHRcdCQkLndpZHRoID0gJCh3aW5kb3cpLndpZHRoKCk7XG5cdFx0JCQuaGVpZ2h0ID0gJCh3aW5kb3cpLmhlaWdodCgpO1xuXHRcdCQkLnBpeGVsX3JhdGlvID0gJHdpbmRvdy5kZXZpY2VQaXhlbFJhdGlvIHx8IDE7XG5cdFx0JCQuc2NyZWVuX3JhdGlvID0gJCQud2lkdGggLyAkJC5oZWlnaHQ7XG5cdFx0JCQuY2FtZXJhLmFzcGVjdCA9ICQkLnNjcmVlbl9yYXRpbztcblx0XHQkJC5jYW1lcmEudXBkYXRlUHJvamVjdGlvbk1hdHJpeCgpO1xuXHRcdCQkLnJlbmRlcmVyLnNldFNpemUoICQkLndpZHRoLCAkJC5oZWlnaHQgKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHNldHVwKCkge1xuXG5cdH1cblxuXHRmdW5jdGlvbiB1cGRhdGUoKSB7XG5cblx0XHRpZiAoIE1hdGguYWJzKCAkJC53aGVlbF9keSApID4gMC4wMDEgKSB7XG5cdFx0XHQkJC5jYW1lcmEucG9zaXRpb24ueSArPSAkJC53aGVlbF9keSAqIDEuMDtcblx0XHRcdCQkLmNhbWVyYS5yb3RhdGVZKCAkJC53aGVlbF9keSAqIDAuMDI1ICk7XG5cdFx0XHQkJC53aGVlbF9keSAqPSAwLjk1O1xuXHRcdH1cblxuXHR9XG5cblx0Ly8gLS0tLSAgZHJhdyBsb29wXG5cdGZ1bmN0aW9uIHJ1bigpIHtcblxuXHRcdHJlcXVlc3RBbmltYXRpb25GcmFtZSggcnVuICk7XG5cdFx0dXBkYXRlKCk7XG5cdFx0JCQucmVuZGVyZXIucmVuZGVyKCAkJC5zY2VuZSwgJCQuY2FtZXJhICk7XG5cdFx0JCQuc3RhdHMudXBkYXRlKCk7XG5cblx0fVxuXG5cdGZ1bmN0aW9uIHN0YXJ0KCkge1xuXHRcdHNldHVwKCk7XG5cdFx0cnVuKCk7XG5cdH1cblxuXHRmdW5jdGlvbiByZXNldENhbWVyYSgpIHtcblx0XHQkJC5jYW1lcmEucG9zaXRpb24uc2V0KCAwLCAwLCAwICk7XG5cdFx0JCQuY2FtZXJhLnJvdGF0aW9uLnNldCggMCwgMCwgMCApO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHQkJCxcblx0XHRhdHRhY2hSZW5kZXJlcixcblx0XHRvbldpbmRvd1Jlc2l6ZSxcblx0XHRzdGFydCxcblx0XHRyZXNldENhbWVyYSxcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5HSU5FJywgJyRjb21waWxlJywgJyRyb290U2NvcGUnLFxuZnVuY3Rpb24gKCBsb2csIEVOR0lORSwgJGNvbXBpbGUsICRyb290U2NvcGUgKSB7XG5cblx0dmFyIGFsbFBvc3RlcnMgPSBuZXcgVEhSRUUuT2JqZWN0M0QoKTtcblx0RU5HSU5FLiQkLnNjZW5lLmFkZCggYWxsUG9zdGVycyApO1xuXG5cdGZ1bmN0aW9uIG1ha2VIZWxpeFBvc3RlcnMoIHBvc3Rlck9iamVjdE11bHRpLCBvZmZzZXRTdGFydElkeCApIHtcblxuXHRcdHZhciB2ZWN0b3IgPSBuZXcgVEhSRUUuVmVjdG9yMygpO1xuXHRcdHZhciByYWRpdXMgPSA5MDA7XG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgcG9zdGVyT2JqZWN0TXVsdGkubGVuZ3RoOyBpKysgKSB7XG5cblx0XHRcdHZhciAkaXNvbGF0ZWRTY29wZSA9ICRyb290U2NvcGUuJG5ldyggdHJ1ZSApO1xuXHRcdFx0JGlzb2xhdGVkU2NvcGUubW92aWVJdGVtID0gcG9zdGVyT2JqZWN0TXVsdGlbIGkgXTtcblxuXHRcdFx0dmFyIHBvc3RlckRpcmVjdGl2ZUVsZW0gPSAkY29tcGlsZSggJzxwb3N0ZXI+PC9wb3N0ZXI+JyApKCAkaXNvbGF0ZWRTY29wZSApWyAwIF07XG5cdFx0XHR2YXIgY3NzM2RPYmogPSBuZXcgVEhSRUUuQ1NTM0RPYmplY3QoIHBvc3RlckRpcmVjdGl2ZUVsZW0gKTtcblxuXHRcdFx0Ly8gdGFnIGFsb2cgYW4gaXNvbGF0ZWRTY29wZSB0byBiZSBkZXN0cm95IHdoZW4gZGlzcG9zZSBhbiBlbGVtZW50XG5cdFx0XHRjc3MzZE9iai5zY29wZSA9ICRpc29sYXRlZFNjb3BlO1xuXG5cdFx0XHR2YXIgaGlkeCA9IGkgKyBvZmZzZXRTdGFydElkeDtcblx0XHRcdHZhciBwaGkgPSBoaWR4ICogMC4xNzUgKyBNYXRoLlBJO1xuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueCA9IC0gcmFkaXVzICogTWF0aC5zaW4oIHBoaSApO1xuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueSA9IC0gKCBoaWR4ICogOCApICsgMjAwO1xuXHRcdFx0Y3NzM2RPYmoucG9zaXRpb24ueiA9IHJhZGl1cyAqIE1hdGguY29zKCBwaGkgKTtcblxuXHRcdFx0dmVjdG9yLnNldCggLWNzczNkT2JqLnBvc2l0aW9uLnggKiAyLCBjc3MzZE9iai5wb3NpdGlvbi55LCAtY3NzM2RPYmoucG9zaXRpb24ueiAqIDIgKTtcblxuXHRcdFx0Y3NzM2RPYmoubG9va0F0KCB2ZWN0b3IgKTtcblx0XHRcdGFsbFBvc3RlcnMuYWRkKCBjc3MzZE9iaiApO1xuXG5cdFx0fVxuXG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICdjdXJyIHBvc3RlcnM6JywgYWxsUG9zdGVycy5jaGlsZHJlbi5sZW5ndGggKTtcblxuXHR9XG5cblx0ZnVuY3Rpb24gY2xlYXJBbGwoKSB7XG5cdFx0YWxsUG9zdGVycy5jaGlsZHJlbi5mb3JFYWNoKCBmdW5jdGlvbiAoIHBvc3RlciApIHtcblx0XHRcdHBvc3Rlci5kaXNwb3NlRWxlbWVudCgpO1xuXHRcdFx0cG9zdGVyLnNjb3BlLiRkZXN0cm95KCk7XG5cdFx0fSApO1xuXHRcdGFsbFBvc3RlcnMuY2hpbGRyZW4ubGVuZ3RoID0gMDsgLy8gY2xlYXIgaXRlbXNcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0bWFrZUhlbGl4UG9zdGVycyxcblx0XHRjbGVhckFsbFxuXHR9O1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJyRzdGF0ZScsICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgZnVuY3Rpb24gKCAkc3RhdGUsIGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCApIHtcblxuXHRcdC8vICRzY29wZS5tb3ZpZUl0ZW0gb2JqIGlzIHBhc3NlZCB0aHJ1IGlzb2xhdGVkU2NvcGUgdmlhIGNvbXBpbGVkIGRpcmVjdGl2ZSBpbiBoZWxpeC5mYWMuanNcblx0XHR2YXIgaW1nID0gbmV3IEltYWdlKCk7XG5cdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL3cxNTQvJyArICRzY29wZS5tb3ZpZUl0ZW0ucG9zdGVyX3BhdGg7XG5cdFx0aW1nLm9ubG9hZCA9IGZ1bmN0aW9uICgpIHtcblxuXHRcdFx0Ly8gdG9kbyBtb3ZlIGNzcyBpbnRvIHNhc3MsIHVzZSBjbGFzcyBpbnN0ZWFkXG5cdFx0XHQkZWxlbWVudC5jc3MoIHtcblx0XHRcdFx0J3dpZHRoJzogJzE1MHB4Jyxcblx0XHRcdFx0J2hlaWdodCc6ICcyMzBweCcsXG5cdFx0XHRcdCdiYWNrZ3JvdW5kLXJlcGVhdCc6ICduby1yZXBlYXQnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1zaXplJzogJzE1MHB4IDIzMHB4Jyxcblx0XHRcdFx0J2JhY2tncm91bmQtaW1hZ2UnOiAndXJsKCcgKyBpbWdVcmwgKyAnKScsXG5cdFx0XHRcdCdkaXNwbGF5JzogJ25vbmUnIC8vIHJlcXVpcmVkIGZvciBmYWRlSW4gYW5pbWF0aW9uXG5cdFx0XHR9ICk7XG5cdFx0XHQkZWxlbWVudC5mYWRlSW4oIDE1MDAgKTtcblxuXHRcdH07XG5cdFx0aW1nLnNyYyA9IGltZ1VybDtcblxuXHRcdCRlbGVtZW50Lm9uKCAnY2xpY2snLCBmdW5jdGlvbiAoIGV2dCApIHtcblx0XHRcdCRzdGF0ZS5nbyggJ21vdmllRGV0YWlsJywgeyBtb3ZpZUlkOiAkc2NvcGUubW92aWVJdGVtLmlkIH0gKTtcblx0XHRcdGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2Uuc2V0QWN0aXZlSXRlbSggJHNjb3BlLm1vdmllSXRlbSApO1xuXHRcdH0gKTtcblxuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRyZXN0cmljdDogJ0UnLFxuXHRcdHJlcGxhY2U6IHRydWUsXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHR0ZW1wbGF0ZTogJzxkaXYgY2xhc3M9XCJwb3N0ZXJFbGVtXCI+PC9kaXY+J1xuXHR9O1xuXG59IF07XG4iLCJhbmd1bGFyLm1vZHVsZSggJ2FwcCcsIFtcblx0J3VpLnJvdXRlcicsXG5cdCduZ0FuaW1hdGUnXG5dIClcbi5jb25zdGFudCggJ0VORFBPSU5UX1VSSScsICdodHRwOi8vbG9jYWxob3N0OjgwMDEvJyApXG4uY29uc3RhbnQoICdUTURCX0FQSScsIHtcblx0a2V5OiAnMzc0YzAzNDJhNjQwNmRmZTBhZWIzZGUyZWEwNDJjNTknLFxuXHR1cmw6ICdodHRwOi8vYXBpLnRoZW1vdmllZGIub3JnLzMvJ1xufSApXG5cbi5wcm92aWRlciggJ2xvZycsIHJlcXVpcmUoICcuL2NvbW1vbi9sb2cucHYuanMnICkgKVxuLmZhY3RvcnkoICd1dGlsJywgcmVxdWlyZSggJy4vY29tbW9uL3V0aWwuanMnICkgKVxuLmZhY3RvcnkoICdFVlQnLCByZXF1aXJlKCAnLi9jb21tb24vZXZlbnRzLmZhYy5qcycgKSApXG5cbi5mYWN0b3J5KCAnVE1EYicsIHJlcXVpcmUoICcuL0FQSS9UTURiLmZhYy5qcycgKSApXG5cbi5jb250cm9sbGVyKCAnbWFpbkN0cmwnLCByZXF1aXJlKCAnLi9tYWluLmN0cmwuanMnICkgKVxuLmZhY3RvcnkoICdFTkdJTkUnLCByZXF1aXJlKCAnLi9oZWxpeC9lbmdpbmUuZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnaGVsaXgnLCByZXF1aXJlKCAnLi9oZWxpeC9oZWxpeC5mYWMuanMnICkgKVxuLmRpcmVjdGl2ZSggJ2Rpc3BsYXknLCByZXF1aXJlKCAnLi9oZWxpeC9kaXNwbGF5LmRpci5qcycgKSApXG4uZGlyZWN0aXZlKCAncG9zdGVyJywgcmVxdWlyZSggJy4vaGVsaXgvcG9zdGVyLmRpci5qcycgKSApXG5cbi5jb250cm9sbGVyKCAnbW92aWVEZXRhaWxDdHJsJywgcmVxdWlyZSggJy4vbW92aWVEZXRhaWwuY3RybC5qcycgKSApXG5cbi5mYWN0b3J5KCAnYXV0aCcsIHJlcXVpcmUoICcuL2F1dGgvYXV0aC5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdhdXRoVG9rZW4nLCByZXF1aXJlKCAnLi9hdXRoL2F1dGhUb2tlbi5mYWMuanMnICkgKVxuLmZhY3RvcnkoICdhdXRoSW50ZXJjZXB0b3InLCByZXF1aXJlKCAnLi9hdXRoL2F1dGhJbnRlcmNlcHRvci5mYWMuanMnICkgKVxuLmNvbnRyb2xsZXIoICdzaWdudXBDdHJsJywgcmVxdWlyZSggJy4vYXV0aC9zaWdudXAuY3RybC5qcycgKSApXG4uY29udHJvbGxlciggJ3NpZ25pbkN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ25pbi5jdHJsLmpzJyApIClcbi5jb250cm9sbGVyKCAnc2lnbm91dEN0cmwnLCByZXF1aXJlKCAnLi9hdXRoL3NpZ25vdXQuY3RybC5qcycgKSApXG5cbi5jb250cm9sbGVyKCAnbW92aWVDb2xsZWN0aW9uQ3RybCcsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9tb3ZpZUNvbGxlY3Rpb24uY3RybC5qcycgKSApXG4uZmFjdG9yeSggJ21vdmllQ29sbGVjdGlvbicsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9tb3ZpZUNvbGxlY3Rpb24uZmFjLmpzJyApIClcbi5mYWN0b3J5KCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsIHJlcXVpcmUoICcuL21vdmllQ29sbGVjdGlvbi9jb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLmZhYy5qcycgKSApXG4uZGlyZWN0aXZlKCAnY29sbGVjdGlvbk1vZGFsJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25Nb2RhbC5kaXIuanMnICkgKVxuLmRpcmVjdGl2ZSggJ2NvbGxlY3Rpb25JdGVtJywgcmVxdWlyZSggJy4vbW92aWVDb2xsZWN0aW9uL2NvbGxlY3Rpb25JdGVtLmRpci5qcycgKSApXG5cbi5kaXJlY3RpdmUoICdob3ZlckNsYXNzJywgcmVxdWlyZSggJy4vZGlyZWN0aXZlL2hvdmVyQ2xhc3MuZGlyLmpzJyApIClcblxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL3JvdXRlQ29uZmlnLmpzJyApIClcbi5jb25maWcoIHJlcXVpcmUoICcuL2NvbmZpZy9sb2dDb25maWcuanMnICkgKVxuLmNvbmZpZyggcmVxdWlyZSggJy4vY29uZmlnL2h0dHBDb25maWcuanMnICkgKVxuLnJ1biggWyAnbG9nJywgJyRyb290U2NvcGUnLCAnJHN0YXRlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgZnVuY3Rpb24gKCBsb2csICRyb290U2NvcGUsICRzdGF0ZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uICkge1xuXG5cdGF1dGguYXV0aG9yaXplKCB0cnVlICk7XG5cblx0bW92aWVDb2xsZWN0aW9uLnJlc29sdmVDb2xsZWN0aW9uKCk7XG5cblx0JHJvb3RTY29wZS4kb24oICckc3RhdGVDaGFuZ2VFcnJvcicsIGZ1bmN0aW9uICggZXZlbnQsIHRvU3RhdGUsIHRvUGFyYW1zLCBmcm9tU3RhdGUsIGZyb21QYXJhbXMsIGVycm9yICkge1xuXG5cdFx0ZXZlbnQucHJldmVudERlZmF1bHQoKTsgLy8gcHJldmVudCB0cmFuc2l0aW9uXG5cdFx0bG9nLmRlYnVnKCAnd2FybicsIGVycm9yICk7XG5cdFx0aWYgKCBlcnJvciApIHtcblx0XHRcdCRzdGF0ZS5nbyggJ3NpZ25pbicgKTtcblx0XHR9XG5cblx0fSApO1xuXG59IF0gKVxuO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnRVZUJywgJ2hlbGl4JywgJ0VOR0lORScsICdhdXRoJywgJyRzdGF0ZScsICckcm9vdFNjb3BlJyxcbmZ1bmN0aW9uICggbG9nLCAkc2NvcGUsIFRNRGIsIEVWVCwgaGVsaXgsIEVOR0lORSwgYXV0aCwgJHN0YXRlLCAkcm9vdFNjb3BlICkge1xuXG5cdHZhciB2bSA9IHRoaXM7XG5cdHZtLmF1dGggPSBhdXRoO1xuXHR2bS5zZWFyY2ggPSB7XG5cdFx0cXVlcnk6ICcnLFxuXHR9O1xuXHR2bS5tb3ZpZUl0ZW1zID0gbnVsbDtcblxuXHQkc2NvcGUuJHdhdGNoKCBUTURiLmdldFJlcywgZnVuY3Rpb24gKCBtb3ZJdGVtcywgb2xkTW92SXRlbXMgKSB7XG5cblx0XHR2bS5tb3ZpZUl0ZW1zID0gbW92SXRlbXM7XG5cdFx0aGVsaXgubWFrZUhlbGl4UG9zdGVycyggbW92SXRlbXMuc2xpY2UoIG9sZE1vdkl0ZW1zLmxlbmd0aCApLCBvbGRNb3ZJdGVtcy5sZW5ndGggKTtcblxuXHR9LCB0cnVlICk7XG5cblx0dmFyIHByZXZRdWVyeSA9ICcnO1xuXHR2YXIgaGVsaXhOZWVkc1Jlc2V0ID0gZmFsc2U7XG5cdEVWVC5oZWxpeE5lZWRzUmVzZXQubGlzdGVuKCBmdW5jdGlvbiAoKSB7XG5cdFx0aGVsaXhOZWVkc1Jlc2V0ID0gdHJ1ZTtcblx0fSApO1xuXG5cdHZtLnNlYXJjaCA9IGZ1bmN0aW9uICgpIHtcblx0XHRpZiAoIHZtLnNlYXJjaC5xdWVyeSA9PT0gJycgKSByZXR1cm47XG5cdFx0aWYgKCBwcmV2UXVlcnkgIT09IHZtLnNlYXJjaC5xdWVyeSB8fCBoZWxpeE5lZWRzUmVzZXQgKSB7XG5cdFx0XHRwcmV2UXVlcnkgPSB2bS5zZWFyY2gucXVlcnk7XG5cdFx0XHRUTURiLmNsZWFyU2VhcmNoKCk7XG5cdFx0XHRoZWxpeC5jbGVhckFsbCgpO1xuXHRcdFx0RU5HSU5FLnJlc2V0Q2FtZXJhKCk7XG5cdFx0XHRoZWxpeE5lZWRzUmVzZXQgPSBmYWxzZTtcblx0XHR9XG5cdFx0aWYgKCAkc3RhdGUuY3VycmVudC5uYW1lICE9PSAnaGVsaXgnICkge1xuXHRcdFx0JHN0YXRlLmdvKCAnaGVsaXgnICk7XG5cdFx0fVxuXHRcdFRNRGIuc2VhcmNoQnlUaXRsZSggdm0uc2VhcmNoICk7XG5cdH07XG5cblx0Ly8gREVCVUdcblx0d2luZG93LlNDT1BFID0gJHNjb3BlO1xuXHR2bS5UTURiID0gVE1EYjtcblx0dm0uaGVsaXggPSBoZWxpeDtcblx0dm0uRU5HSU5FID0gRU5HSU5FO1xuXHR2bS5TVEFURSA9ICRzdGF0ZTtcblxuXHRFVlQuRU9QLmxpc3RlbiggZnVuY3Rpb24gKCkge1xuXHRcdGxvZy5kZWJ1ZyggJ2luZm8nLCAncmVjaWV2ZWQgRU9QIGV2ZW50IScgKTtcblx0fSApO1xuXG59IF07XG4iLCJtb2R1bGUuZXhwb3J0cyA9IFsgJ2xvZycsICdUTURiJywgZnVuY3Rpb24gKCBsb2csIFRNRGIgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkYXR0cnMsICRlbGVtZW50ICkge1xuXG5cdFx0VE1EYi5zZWFyY2hCeUlkKCBwYXJzZUludCggJHNjb3BlLm1vdmllSWQgKSApXG5cdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXG5cdFx0XHQvLyBsb2cuZGVidWcoICdpbmZvJywgJ2NvbGxlY3Rpb25JdGVtRGlyZWN0aXZlJywgcmVzICk7XG5cdFx0XHR2YXIgaW1nVXJsID0gJ2h0dHA6Ly9pbWFnZS50bWRiLm9yZy90L3AvdzkyLycgKyByZXMucG9zdGVyX3BhdGg7XG5cdFx0XHQkZWxlbWVudC5jc3MoIHtcblx0XHRcdFx0J3dpZHRoJzogJzEwMCUnLFxuXHRcdFx0XHQnaGVpZ2h0JzogJzEwMCUnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1yZXBlYXQnOiAnbm8tcmVwZWF0Jyxcblx0XHRcdFx0J2JhY2tncm91bmQtc2l6ZSc6ICcxMDAlIDEwMCUnLFxuXHRcdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJ1xuXHRcdFx0fSApO1xuXG5cdFx0fSwgZnVuY3Rpb24gKCBlcnIgKSB7XG5cdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbkl0ZW1EaXJlY3RpdmUnLCBlcnIgKTtcblx0XHR9ICk7XG5cblx0fVxuXG5cdHJldHVybiB7XG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRyZXBsYWNlOiB0cnVlLFxuXHRcdHNjb3BlOiB7IG1vdmllSWQ6ICdAJyB9LFxuXHRcdGNvbnRyb2xsZXI6IGN0cmwsXG5cdFx0Y29udHJvbGxlckFzOiAnY2knLFxuXHRcdHRlbXBsYXRlOiAnPGRpdj48L2Rpdj4nXG5cdH07XG5cbn0gXTtcbiIsIm1vZHVsZS5leHBvcnRzID0gWyAnbG9nJywgJ21vdmllQ29sbGVjdGlvbicsICdjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlJywgJ0VWVCcsXG5mdW5jdGlvbiAoIGxvZywgbW92aWVDb2xsZWN0aW9uLCBjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLCBFVlQgKSB7XG5cblx0ZnVuY3Rpb24gY3RybCggJHNjb3BlLCAkZWxlbWVudCwgJGF0dHJzICkge1xuXG5cdFx0dmFyIHZtID0gdGhpcztcblx0XHR2bS5tb3ZpZUNvbGxlY3Rpb24gPSBtb3ZpZUNvbGxlY3Rpb247XG5cdFx0dm0uY29sbGVjdGlvbk1vZGFsU2VydmljZSA9IGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2U7XG5cblx0XHR2bS5hZGRpbmdOZXdDb2xsZWN0aW9uID0gZmFsc2U7XG5cblx0XHR2bS5vcGVuRWRpdG9yID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IHRydWU7XG5cdFx0fTtcblxuXHRcdHZtLmNsb3NlRWRpdG9yID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xuXHRcdH07XG5cblx0XHR2bS5jcmVhdGVOZXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0aWYgKCAkc2NvcGUubmV3Q29sbGVjdGlvbk5hbWUgKSB7XG5cdFx0XHRcdG1vdmllQ29sbGVjdGlvbi5jcmVhdGUoICRzY29wZS5uZXdDb2xsZWN0aW9uTmFtZSApO1xuXHRcdFx0XHQkc2NvcGUubmV3Q29sbGVjdGlvbk5hbWUgPSAnJztcblx0XHRcdFx0dm0uY2xvc2VFZGl0b3IoKTtcblx0XHRcdH1cblx0XHR9O1xuXG5cdFx0dm0uYWRkVG9Db2xsZWN0aW9uID0gZnVuY3Rpb24gKCBtb3ZpZUlkLCBjb2xsZWN0aW9uTmFtZSApIHtcblx0XHRcdGlmICggbW92aWVDb2xsZWN0aW9uLmhhc0l0ZW0oIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICkgKSB7XG5cdFx0XHRcdG1vdmllQ29sbGVjdGlvbi5yZW1vdmUoIG1vdmllSWQsIGNvbGxlY3Rpb25OYW1lICk7XG5cdFx0XHR9IGVsc2Uge1xuXHRcdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2FkZFRvQ29sbGVjdGlvbjonLCBtb3ZpZUlkLCBjb2xsZWN0aW9uTmFtZSApO1xuXHRcdFx0XHR2YXIgc3VjY2VzcyA9IG1vdmllQ29sbGVjdGlvbi5wdXNoKCBtb3ZpZUlkLCBjb2xsZWN0aW9uTmFtZSApO1xuXHRcdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ21vdmllQ29sbGVjdGlvbi5wdXNoJywgc3VjY2VzcyApO1xuXHRcdFx0fVxuXHRcdH07XG5cblx0XHR2bS5jbG9zZU1vZGFsID0gZnVuY3Rpb24gKCkge1xuXHRcdFx0dm0uYWRkaW5nTmV3Q29sbGVjdGlvbiA9IGZhbHNlO1xuXHRcdFx0JHNjb3BlLm5ld0NvbGxlY3Rpb25OYW1lID0gJyc7XG5cdFx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLmNsb3NlKCk7XG5cdFx0fTtcblxuXHRcdC8vIGRlZmF1bHQgY3NzIGF0IGRpcmVjdGl2ZSBpbml0aWFsaXphdGlvblxuXHRcdCRlbGVtZW50LmNzcyggeyB2aXNpYmlsaXR5OiAnaGlkZGVuJyB9ICk7XG5cblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsT3Blbi5saXN0ZW4oIGZ1bmN0aW9uICgpIHtcblx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbk1vZGFsT3BlbicgKTtcblx0XHQkZWxlbWVudC5jc3MoIHsgdmlzaWJpbGl0eTogJ3Zpc2libGUnIH0gKTtcblx0XHR9ICk7XG5cblx0XHRFVlQuY29sbGVjdGlvbk1vZGFsQ2xvc2UubGlzdGVuKCBmdW5jdGlvbiAoKSB7XG5cdFx0XHRsb2cuZGVidWcoICdjb2xsZWN0aW9uJywgJ2NvbGxlY3Rpb25Nb2RhbENsb3NlJyApO1xuXHRcdCRlbGVtZW50LmNzcyggeyB2aXNpYmlsaXR5OiAnaGlkZGVuJyB9ICk7XG5cdFx0fSApO1xuXG5cdH1cblxuXHRyZXR1cm4ge1xuXG5cdFx0cmVzdHJpY3Q6ICdFJyxcblx0XHRzY29wZToge30sXG5cdFx0Y29udHJvbGxlcjogY3RybCxcblx0XHRjb250cm9sbGVyQXM6ICdtb2RhbCcsXG5cdFx0cmVwbGFjZTogdHJ1ZSxcblx0XHR0ZW1wbGF0ZVVybDogJy4vdGVtcGxhdGUvY29sbGVjdGlvbk1vZGFsLmh0bWwnXG5cblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRVZUJywgJ2F1dGgnLCAnJHN0YXRlJywgZnVuY3Rpb24gKCBsb2csIEVWVCwgYXV0aCwgJHN0YXRlICkge1xuXG5cdHZhciBhY3RpdmVJdGVtID0gbnVsbDtcblxuXHRmdW5jdGlvbiBzZXRBY3RpdmVJdGVtKCBpdGVtICkge1xuXHRcdGFjdGl2ZUl0ZW0gPSBpdGVtO1xuXHR9XG5cblx0ZnVuY3Rpb24gZ2V0QWN0aXZlSXRlbSggaXRlbSApIHtcblx0XHRyZXR1cm4gYWN0aXZlSXRlbTtcblx0fVxuXG5cdGZ1bmN0aW9uIG9wZW4oKSB7XG5cdFx0aWYgKCBhdXRoLmlzQXV0aGVudGljYXRlZCgpICkge1xuXHRcdFx0RVZULmNvbGxlY3Rpb25Nb2RhbE9wZW4uZW1pdCgpO1xuXHRcdH0gZWxzZSB7XG5cdFx0XHQkc3RhdGUuZ28oICdzaWduaW4nICk7XG5cdFx0fVxuXHR9XG5cblx0ZnVuY3Rpb24gY2xvc2UoKSB7XG5cdFx0RVZULmNvbGxlY3Rpb25Nb2RhbENsb3NlLmVtaXQoKTtcblx0fVxuXG5cdHJldHVybiB7XG5cdFx0c2V0QWN0aXZlSXRlbSxcblx0XHRnZXRBY3RpdmVJdGVtLFxuXHRcdG9wZW4sXG5cdFx0Y2xvc2Vcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ2F1dGgnLCAnbW92aWVDb2xsZWN0aW9uJywgJ1RNRGInLCAnaGVsaXgnLCAnRU5HSU5FJywgJyRzdGF0ZScsICdFVlQnLFxuZnVuY3Rpb24gKCBsb2csICRzY29wZSwgYXV0aCwgbW92aWVDb2xsZWN0aW9uLCBUTURiLCBoZWxpeCwgRU5HSU5FLCAkc3RhdGUsIEVWVCApICB7XG5cblx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdjb2xsZWN0aW9uQ3RybCcsIG1vdmllQ29sbGVjdGlvbi5nZXRDb2xsZWN0aW9uKCkgKTtcblx0dmFyIHZtID0gdGhpcztcblx0dm0ubW92aWVDb2xsZWN0aW9uID0gbW92aWVDb2xsZWN0aW9uO1xuXG5cdHZtLnZpZXdDb2xsZWN0aW9uID0gZnVuY3Rpb24gKCBjb2xsZWN0aW9uICkge1xuXG5cdFx0bG9nLmRlYnVnKCAnaW5mbycsICd2aWV3Q29sbGVjdGlvbiA9PicsIGNvbGxlY3Rpb24gKTtcblxuXHRcdHZhciBsb2FkZWRJdGVtcyA9IDA7XG5cdFx0dmFyIHRvdGFsSXRlbXMgPSBjb2xsZWN0aW9uLm1vdmllcy5sZW5ndGg7XG5cdFx0dmFyIGFsbE1vdmllcyA9IFtdO1xuXG5cdFx0Y29sbGVjdGlvbi5tb3ZpZXMuZm9yRWFjaCggZnVuY3Rpb24gKCBtb3ZpZUlkICkge1xuXG5cdFx0XHRUTURiLnNlYXJjaEJ5SWQoIG1vdmllSWQgKVxuXHRcdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRcdFx0YWxsTW92aWVzLnB1c2goIHJlcyApO1xuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAndmlld0NvbGxlY3Rpb24gPT4nLCBlcnIgKTtcblx0XHRcdFx0fSApXG5cdFx0XHRcdC5maW5hbGx5KCBmdW5jdGlvbiAoKSB7XG5cdFx0XHRcdFx0aWYgKCArK2xvYWRlZEl0ZW1zID09PSB0b3RhbEl0ZW1zICkge1xuXG5cdFx0XHRcdFx0XHRoZWxpeC5jbGVhckFsbCgpO1xuXHRcdFx0XHRcdFx0RU5HSU5FLnJlc2V0Q2FtZXJhKCk7XG5cdFx0XHRcdFx0XHRoZWxpeC5tYWtlSGVsaXhQb3N0ZXJzKCBhbGxNb3ZpZXMsIDAgKTtcblx0XHRcdFx0XHRcdCRzdGF0ZS5nbyggJ2hlbGl4JyApO1xuXHRcdFx0XHRcdFx0VE1EYi5jbGVhclNlYXJjaCgpO1xuXHRcdFx0XHRcdFx0RVZULmhlbGl4TmVlZHNSZXNldC5lbWl0KCk7XG5cblx0XHRcdFx0XHR9XG5cdFx0XHRcdH0gKTtcblxuXHRcdH0gKTtcblxuXG5cdH07XG5cblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnRU5EUE9JTlRfVVJJJywgJyRodHRwJywgJyRxJywgZnVuY3Rpb24gKCBsb2csIEVORFBPSU5UX1VSSSwgJGh0dHAsICRxICkge1xuXG5cdHZhciBEQl9FTkRQT0lOVCA9IEVORFBPSU5UX1VSSSArICdjb2xsZWN0aW9uJztcblx0dmFyIGNvbGxlY3Rpb24gPSBudWxsO1xuXG5cdHZhciBmdWxsQ29sbGVjdGlvbiA9IG51bGw7XG5cblx0ZnVuY3Rpb24gY3JlYXRlKCBuYW1lICkge1xuXHRcdGNvbGxlY3Rpb24ucHVzaCggeyBjb2xsZWN0aW9uTmFtZTogbmFtZSwgbW92aWVzOiBbXSB9ICk7XG5cdFx0cHV0KCk7XG5cdH1cblxuXHRmdW5jdGlvbiBpc0VtcHR5KCkge1xuXHRcdHJldHVybiBjb2xsZWN0aW9uLmxlbmd0aCA9PT0gMDtcblx0fVxuXG5cdGZ1bmN0aW9uIHJlc29sdmVDb2xsZWN0aW9uKCkge1xuXG5cdFx0dmFyIGRlZmVycmVkID0gJHEuZGVmZXIoKTtcblxuXHRcdGlmICggY29sbGVjdGlvbiAhPT0gbnVsbCApIHtcblx0XHRcdGRlZmVycmVkLnJlc29sdmUoIGNvbGxlY3Rpb24gKTtcblx0XHR9IGVsc2Uge1xuXHRcdFx0JGh0dHAuZ2V0KCBEQl9FTkRQT0lOVCwgeyByZXF1aXJlQXV0aDogdHJ1ZSB9IClcblx0XHRcdFx0LnRoZW4oIGZ1bmN0aW9uICggcmVzICkge1xuXHRcdFx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpOicsIHJlcyApO1xuXHRcdFx0XHRcdGlmICggcmVzLmRhdGEgKSB7XG5cdFx0XHRcdFx0XHRjb2xsZWN0aW9uID0gcmVzLmRhdGE7XG5cdFx0XHRcdFx0fSBlbHNlIHtcblx0XHRcdFx0XHRcdGNvbGxlY3Rpb24gPSBbXTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdFx0ZGVmZXJyZWQucmVzb2x2ZSggdHJ1ZSApO1xuXHRcdFx0XHR9LCBmdW5jdGlvbiAoIGVyciApIHtcblx0XHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5yZXNvbHZlQ29sbGVjdGlvbigpOicsIGVyciApO1xuXHRcdFx0XHRcdGRlZmVycmVkLnJlamVjdCggZXJyICk7XG5cdFx0XHRcdH0gKTtcblx0XHR9XG5cblx0XHRyZXR1cm4gZGVmZXJyZWQucHJvbWlzZTtcblxuXHR9XG5cblx0ZnVuY3Rpb24gaGFzSXRlbSggaXRlbUlkLCBzb21lQ29sbGVjdGlvbiApIHtcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gc29tZUNvbGxlY3Rpb24gKSB7XG5cdFx0XHRcdGZvciAoIHZhciBrID0gMDsgayA8IGNvbGxlY3Rpb25baV0ubW92aWVzLmxlbmd0aDsgayArKyApIHtcblx0XHRcdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0ubW92aWVzW2tdID09PSBpdGVtSWQgKSB7XG5cdFx0XHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdFx0XHR9XG5cdFx0XHRcdH1cblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gcHV0KCkge1xuXHRcdCRodHRwLnB1dCggREJfRU5EUE9JTlQsIGNvbGxlY3Rpb24sIHsgcmVxdWlyZUF1dGg6IHRydWUgfSApXG5cdFx0XHQudGhlbiggZnVuY3Rpb24gKCByZXMgKSB7XG5cdFx0XHRcdGxvZy5kZWJ1ZyggJ2NvbGxlY3Rpb24nLCAnY29sbGVjdGlvbi5wdXQoKTonLCByZXMgKTtcblx0XHRcdH0sIGZ1bmN0aW9uICggZXJyICkge1xuXHRcdFx0XHRsb2cuZGVidWcoICdlcnInLCAnY29sbGVjdGlvbi5wdXQoKTonLCBlcnIgKTtcblx0XHRcdH0gKTtcblx0fVxuXG5cdGZ1bmN0aW9uIHB1c2goIGl0ZW1JZCwgdG9Db2xsZWN0aW9uICkge1xuXHRcdGlmICggaGFzSXRlbSggaXRlbUlkLCB0b0NvbGxlY3Rpb24gKSApIHtcblx0XHRcdHJldHVybiBmYWxzZTtcblx0XHR9XG5cdFx0Zm9yICggdmFyIGkgPSAwOyBpIDwgY29sbGVjdGlvbi5sZW5ndGg7IGkgKysgKSB7XG5cdFx0XHRpZiAoIGNvbGxlY3Rpb25baV0uY29sbGVjdGlvbk5hbWUgPT09IHRvQ29sbGVjdGlvbiApIHtcblx0XHRcdFx0Y29sbGVjdGlvbltpXS5tb3ZpZXMucHVzaCggaXRlbUlkICk7XG5cdFx0XHRcdHB1dCgpO1xuXHRcdFx0XHRyZXR1cm4gdHJ1ZTtcblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gcmVtb3ZlKCBpdGVtSWQsIGluQ29sbGVjdGlvbiApIHtcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gaW5Db2xsZWN0aW9uICkge1xuXHRcdFx0XHRmb3IgKCB2YXIgayA9IDA7IGsgPCBjb2xsZWN0aW9uW2ldLm1vdmllcy5sZW5ndGg7IGsgKysgKSB7XG5cdFx0XHRcdFx0aWYgKCBjb2xsZWN0aW9uW2ldLm1vdmllc1trXSA9PT0gaXRlbUlkICkge1xuXHRcdFx0XHRcdFx0dmFyIHJlbW92ZWQgPSBjb2xsZWN0aW9uW2ldLm1vdmllcy5zcGxpY2UoIGssIDEgKS5sZW5ndGg7XG5cdFx0XHRcdFx0XHRwdXQoKTtcblx0XHRcdFx0XHRcdHJldHVybiByZW1vdmVkICE9PSAwO1xuXHRcdFx0XHRcdH1cblx0XHRcdFx0fVxuXHRcdFx0fVxuXHRcdH1cblx0XHRyZXR1cm4gZmFsc2U7XG5cdH1cblxuXHRmdW5jdGlvbiByZW1vdmVDb2xsZWN0aW9uKCBjb2xsZWN0aW9uTmFtZSApIHtcblx0XHRmb3IgKCB2YXIgaSA9IDA7IGkgPCBjb2xsZWN0aW9uLmxlbmd0aDsgaSArKyApIHtcblx0XHRcdGlmICggY29sbGVjdGlvbltpXS5jb2xsZWN0aW9uTmFtZSA9PT0gY29sbGVjdGlvbk5hbWUgKSB7XG5cdFx0XHRcdHZhciByZW1vdmVkID0gY29sbGVjdGlvbi5zcGxpY2UoIGksIDEgKS5sZW5ndGg7XG5cdFx0XHRcdHB1dCgpO1xuXHRcdFx0XHRyZXR1cm4gcmVtb3ZlZCAhPT0gMDtcblx0XHRcdH1cblx0XHR9XG5cdFx0cmV0dXJuIGZhbHNlO1xuXHR9XG5cblx0ZnVuY3Rpb24gc3luYygpIHtcblx0XHQvLyBzeW5jIGxvY2FsIGNvbGVsY3Rpb24gdy8gREJcblx0fVxuXG5cdGZ1bmN0aW9uIGdldENvbGxlY3Rpb24oKSB7XG5cdFx0cmV0dXJuIGNvbGxlY3Rpb247XG5cdH1cblxuXHRmdW5jdGlvbiBfY2xlYXIoKSB7XG5cdFx0Y29sbGVjdGlvbiA9IG51bGw7XG5cdFx0bG9nLmRlYnVnKCAnY29sbGVjdGlvbicsICdsb2NhbCBjb2xsZWN0aW9uIGNsZWFyZWQuJyApO1xuXHR9XG5cblx0cmV0dXJuIHtcblx0XHRnZXRDb2xsZWN0aW9uLFxuXHRcdGNyZWF0ZSxcblx0XHRwdXNoLFxuXHRcdHB1dCxcblx0XHRyZW1vdmUsXG5cdFx0cmVtb3ZlQ29sbGVjdGlvbixcblx0XHRzeW5jLFxuXHRcdF9jbGVhcixcblx0XHRyZXNvbHZlQ29sbGVjdGlvbixcblx0XHRoYXNJdGVtLFxuXHRcdGlzRW1wdHlcblx0fTtcblxufSBdO1xuIiwibW9kdWxlLmV4cG9ydHMgPSBbICdsb2cnLCAnJHNjb3BlJywgJ1RNRGInLCAnJGNhY2hlRmFjdG9yeScsICdtb3ZpZUl0ZW0nLCAnY29sbGVjdGlvbk1vZGFsU2VydmljZScsICdtb3ZpZUNvbGxlY3Rpb24nLFxuZnVuY3Rpb24oIGxvZywgJHNjb3BlLCBUTURiLCAkY2FjaGVGYWN0b3J5LCBtb3ZpZUl0ZW0sIGNvbGxlY3Rpb25Nb2RhbFNlcnZpY2UsIG1vdmllQ29sbGVjdGlvbiApIHtcblxuXHR2YXIgdm0gPSB0aGlzO1xuXHR2bS5tb3ZpZUl0ZW0gPSBtb3ZpZUl0ZW07IC8vIG1vdmllSXRlbSBpbmplY3RlZCB2aWEgc3RhdGUgcmVzb2x2ZVxuXHRsb2cuZGVidWcoICdjdHJsJywgJ21vdmllRGV0YWlsIGN0cmwgcmVzb2x2ZWQ6Jywgdm0ubW92aWVJdGVtICk7XG5cblx0bW92aWVJdGVtLmZ1bGxUaXRsZSA9IG1vdmllSXRlbS50aXRsZTtcblx0aWYgKCBtb3ZpZUl0ZW0udGl0bGUgIT09IG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSApIHtcblx0XHRtb3ZpZUl0ZW0uZnVsbFRpdGxlID0gbW92aWVJdGVtLnRpdGxlICsgJyAoJyArIG1vdmllSXRlbS5vcmlnaW5hbF90aXRsZSArICcpJztcblx0fVxuXG5cdGlmICggbW92aWVJdGVtLmJhY2tkcm9wX3BhdGggKSB7XG5cdFx0dmFyIGltZ1VybCA9ICdodHRwOi8vaW1hZ2UudG1kYi5vcmcvdC9wL29yaWdpbmFsJyArIG1vdmllSXRlbS5iYWNrZHJvcF9wYXRoO1xuXHRcdCQoICcuYmFja2Ryb3AnICkuY3NzKCB7XG5cdFx0XHQnYmFja2dyb3VuZC1pbWFnZSc6ICd1cmwoJyArIGltZ1VybCArICcpJ1xuXHRcdH0gKTtcblx0fVxuXG5cdHZtLm9wZW5Db2xsZWN0aW9uTW9kYWwgPSBmdW5jdGlvbiAoKSB7XG5cdFx0Y29sbGVjdGlvbk1vZGFsU2VydmljZS5zZXRBY3RpdmVJdGVtKCBtb3ZpZUl0ZW0gKTtcblx0XHRjb2xsZWN0aW9uTW9kYWxTZXJ2aWNlLm9wZW4oKTtcblx0fTtcblxufSBdO1xuIl19
