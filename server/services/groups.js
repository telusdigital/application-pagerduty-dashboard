/*
Exports and processing workflow
*/

var subdomain;

module.exports = function (rawServices, domain) {
  subdomain = domain;
  return buildGroups(buildServices(rawServices));
};

/*
Service Processing
*/

function buildServices (rawServices) {
  var services = {};
  rawServices.forEach(function (rawService) {
    services[rawService.name] = buildService(rawService);
  });
  forEachKey(services, function (service, name) {
    parseServiceDependencies(service, services);
  });
  return services;
}

function buildService (rawService) {
  var service = {
    properName: getServiceName(rawService),
    groupName: getServiceGroupName(rawService),
    lastIncidentTime: Date.parse(rawService.last_incident_timestamp),
    description: '', // PagerDuty will not always return a description key
    link: 'https://' + subdomain + '.pagerduty.com' + rawService.service_url
  };
  service.isSiteOrServer =
    service.properName === 'Site' || service.properName === 'Server';
  injectStatusProperties(service, rawService.status);
  forEachKey(rawService, function (value, key) {
    service[key] = value;
  });
  return service;
}

function parseServiceDependencies (service, services) {
  service.dependencies = {};

  var dependencyNames = /\[dashboard-depends\|(.*)]/.exec(service.description);
  if (dependencyNames) {
    dependencyNames[1].split(',').forEach(function (dependencyName) {
      addDependencyToService(dependencyName.trim(), service, services);
    });
  }

  service.dependencies = toArray(service.dependencies);
}

function addDependencyToService (dependencyName, service, services) {
  if (services[dependencyName]) {
    service.dependencies[dependencyName] = services[dependencyName];
  } else {
    try {
      var pattern = new RegExp(dependencyName, 'i');
      forEachKey(services, function (service, name) {
        if (pattern.exec(name)) {
          service.dependencies[name] = service;
        }
      });
    } catch (error) {}
  }
}

/*
Group Processing
*/

var OTHER_PRODUCTS = 'Other Products';
var OTHER_ISSUES = 'Other Issues';

function buildGroups (services) {
  var groups = {};
  groups[OTHER_PRODUCTS] = newGroup(OTHER_PRODUCTS);
  groups[OTHER_ISSUES] = newGroup(OTHER_ISSUES);
  forEachKey(services, function (service, name) {
    addServiceToGroup(service, groups);
  });
  return toArray(groups).map(processGroup);
}

function addServiceToGroup (service, groups) {
  var groupName = service.groupName;
  if (!groups[groupName]) {
    groups[groupName] = newGroup(groupName);
  }
  if (service.isSiteOrServer) {
    groups[groupName][service.properName.toLowerCase()] = service;
  } else {
    groups[groupName].features.push(service);
  }
  if (!service.isOnline) {
    groups[groupName].numberFailures += 1;
  }
}

function newGroup (groupName) {
  return {
    name: groupName,
    id: groupName.toLowerCase().replace(/\s/g, '-'),
    features: [],
    site: false,
    server: false,
    numberFailures: 0,
    isOtherGroup: groupName === OTHER_PRODUCTS || groupName === OTHER_ISSUES
  };
}

function processGroup (group) {
  var dependencies = {};
  var allServices = group.features
    .concat(group.site || []).concat(group.server || []);
  var worstService = allServices[0];
  var lastIncidentTime;

  allServices.forEach(function (service) {
    if (!service.isOnline) {
      lastIncidentTime = lastIncidentTime
        ? Math.min(service.lastIncidentTime, lastIncidentTime)
        : service.lastIncidentTime;
    }
    worstService = worseStatusService(worstService, service);
    service.dependencies.forEach(function (dependency) {
      dependencies[dependency.name] = dependency;
    });
  });

  var worseStatus = worstService ? worstService.status : 'disabled';
  injectStatusProperties(group, worseStatus);
  group.lastIncidentTime = lastIncidentTime || 0;
  group.dependencies = toArray(dependencies);

  return group;
}

/*
Utility Functions
*/

function isPrimaryService (service) {
  return service.description.indexOf('[dashboard-primary]') !== -1;
}

function groupRegexComponent (value, index) {
  // Current format: <groupName>: <serviceName>
  var match = /([^:]*):(.*)/.exec(value);
  return (match ? match[index] : value).trim();
}

function getServiceGroupName (service) {
  if (isPrimaryService(service)) {
    return groupRegexComponent(service.name, 1);
  }
  return isOnline(service) ? OTHER_PRODUCTS : OTHER_ISSUES;
}

function getServiceName (service) {
  if (isPrimaryService(service)) {
    return groupRegexComponent(service.name, 2);
  }
  return service.name;
}

function statusToNumber (status) {
  var statuses = {
    critical: 4,
    warning: 3,
    active: 2,
    maintenance: 1,
    disabled: 0
  };
  return statuses[status] || -1;
}

function isOnline (object) {
  return statusToNumber(object.status) < 3;
}

function worseStatusService (firstService, secondService) {
  return firstService.statusNumber > secondService.statusNumber
    ? firstService : secondService;
}

function injectStatusProperties (object, status) {
  object.status = status;
  object.statusNumber = statusToNumber(status);
  object.isOnline = isOnline(object);
}

function forEachKey (dataObject, operation) {
  Object.keys(dataObject).forEach(function (key, index) {
    operation(dataObject[key], key);
  });
}

function toArray (dataObject) {
  var dataArray = [];
  Object.keys(dataObject).forEach(function (key, index) {
    dataArray.push(dataObject[key]);
  });
  return dataArray;
}
